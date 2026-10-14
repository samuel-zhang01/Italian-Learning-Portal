"""Run maintained trusted-main checks in one owned, offline disposable container."""
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import signal
import subprocess
import sys
import tarfile
import tempfile
import uuid
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = 'samuel-zhang01/Italian-Learning-Portal'
PREFIX = 'italian-ci'
MODES = ('verify',)
CONTEXT_FILES = {'ci/Dockerfile': 'Dockerfile', 'package.json': 'package.json', 'package-lock.json': 'package-lock.json'}
LABELS = ('audit.ci.repo', 'audit.ci.run', 'audit.ci.attempt', 'audit.ci.mode', 'audit.ci.operation')


def command(args, *, timeout=30, check=True, capture=True, env=None, input_data=None):
    return subprocess.run(args, cwd=ROOT, timeout=timeout, check=check,
                          stdout=subprocess.PIPE if capture else None,
                          stderr=subprocess.PIPE if capture else None,
                          text=capture != 'binary', env=env, input=input_data)


def trusted_context(mode):
    if (sys.platform != 'linux' or os.getuid() == 0
            or os.environ.get('GITHUB_REPOSITORY') != REPOSITORY
            or os.environ.get('GITHUB_REF') != 'refs/heads/main'
            or os.environ.get('GITHUB_EVENT_NAME') not in {'push', 'workflow_dispatch'}):
        raise RuntimeError('Only the non-root trusted own-main runner may execute')
    revision = os.environ.get('GITHUB_SHA', '')
    if not re.fullmatch('[0-9a-f]{40}', revision) or command(['git', 'rev-parse', 'HEAD']).stdout.strip() != revision:
        raise RuntimeError('Exact main event revision required')
    command(['git', 'diff', '--quiet']); command(['git', 'diff', '--cached', '--quiet'])
    run, attempt = os.environ.get('GITHUB_RUN_ID', ''), os.environ.get('GITHUB_RUN_ATTEMPT', '')
    if not all(re.fullmatch('[0-9]+', value) for value in (run, attempt)):
        raise RuntimeError('Exact run and attempt required')
    return revision, {'audit.ci.repo': REPOSITORY, 'audit.ci.run': run, 'audit.ci.attempt': attempt,
                      'audit.ci.mode': mode}


class Docker:
    def __init__(self, config):
        self.prefix = ['docker', '--host', 'unix:///var/run/docker.sock', '--config', str(config)]
        self.env = {'PATH': os.environ.get('PATH', '/usr/bin:/bin'), 'LANG': 'C.UTF-8'}

    def call(self, args, **kwargs):
        return command(self.prefix + args, env=self.env, **kwargs)

    def inspect(self, kind, name):
        fields = ['.Id', '.Name', '.Config.Labels'] if kind == 'container' else ['.Id', '.RepoTags', '.Config.Labels']
        response = self.call([kind, 'inspect', '--format', '\n'.join('{{json '+f+'}}' for f in fields), name], check=False)
        if response.returncode:
            missing = r'(?:Error response from daemon: )?No such ' + ('(?:object|container)' if kind == 'container' else 'image') + ': ' + re.escape(name)
            if not response.stdout.strip() and re.fullmatch(missing, response.stderr.strip()):
                return None
            raise RuntimeError('Docker object identity or absence uncertain')
        fields = [json.loads(line) for line in response.stdout.splitlines()]
        if len(fields) != 3 or not re.fullmatch('sha256:[0-9a-f]{64}|[0-9a-f]{64}', fields[0]):
            raise RuntimeError('Invalid Docker identity response')
        return {'id': fields[0], 'name': fields[1], 'labels': fields[2] or {}}

    def remove(self, kind, name, labels):
        obj = self.inspect(kind, name)
        if obj is None:
            return
        operation = obj['labels'].get('audit.ci.operation', '')
        expected = PREFIX+'-'+operation+('-test' if kind == 'container' else ':runtime')
        matches = obj['name'].lstrip('/') == name if kind == 'container' else obj['name'] == [name]
        if (not re.fullmatch('[0-9a-f]{16}', operation) or name != expected or not matches
                or not all(obj['labels'].get(k) == value for k, value in labels.items())):
            raise RuntimeError('Refusing foreign or replaced Docker resource')
        self.call([kind, 'rm']+(['-f'] if kind == 'container' else [])+[obj['id']], timeout=45)
        if self.inspect(kind, name) is not None or self.inspect(kind, obj['id']) is not None:
            raise RuntimeError('Owned resource absence unverified')


def cleanup(docker, owned, labels):
    errors = []
    for kind, name in reversed(owned):
        try:
            docker.remove(kind, name, labels)
        except Exception as error:
            errors.append(type(error).__name__)
    if errors:
        raise RuntimeError('Owned cleanup uncertain: '+','.join(errors))


def dependency_inputs():
    directory = ROOT/'interactive' if REPOSITORY.endswith('/STUDY-RL') else ROOT
    package = json.loads((directory/'package.json').read_text())
    lock = json.loads((directory/'package-lock.json').read_text())
    if lock.get('lockfileVersion') != 3 or lock.get('name') != package.get('name'):
        raise RuntimeError('Exact npm lock metadata required')
    for value in lock.get('packages', {}).values():
        if value.get('link'): raise RuntimeError('Unreviewed linked dependency')
        if 'resolved' in value:
            url = urlsplit(value['resolved'])
            if url.scheme != 'https' or url.hostname != 'registry.npmjs.org' or url.username or url.password:
                raise RuntimeError('Only the public npm registry is reviewed')
            if not value.get('integrity', '').startswith('sha512-'):
                raise RuntimeError('Integrity-bound npm tarballs required')
    if any(name in package.get('scripts', {}) for name in ('preinstall', 'install', 'postinstall')):
        raise RuntimeError('New install lifecycle requires review')


def export_source(destination):
    # Exact tracked tree, no local worktree, Git config, ignored state or hooks.
    tree = command(['git', 'ls-tree', '-r', '-z', 'HEAD'], capture='binary').stdout
    expected = {}
    for row in tree.split(b'\0'):
        if not row:
            continue
        info, name = row.split(b'\t', 1); mode, kind, object_id = info.decode().split()
        name = name.decode('utf-8')
        if mode not in {'100644', '100755'} or kind != 'blob':
            raise RuntimeError('Tracked symlink/submodule refused')
        expected[name] = (mode, object_id)
    if not 1 <= len(expected) <= 3000:
        raise RuntimeError('Tracked source member bound refused')
    data = command(['git', 'archive', '--format=tar', 'HEAD'], timeout=45, capture='binary').stdout
    if len(data) > 128*1024**2:
        raise RuntimeError('Source archive byte bound refused')
    hashes = {}; seen = set()
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:') as archive:
        for item in archive.getmembers():
            path = PurePosixPath(item.name); parts = path.parts
            if (not parts or item.name in seen or item.name.startswith('/') or '..' in parts
                    or not (item.isdir() or item.isfile()) or any(
                        part.startswith('.env') or part in {'.git', '.npmrc', 'node_modules', '.wrangler',
                        '.next', 'dist', 'checkpoints', 'credentials.json', '.secrets', 'local-data'}
                        for part in parts)
                    or path.suffix.lower() in {'.key', '.pem', '.p12', '.pfx', '.sqlite', '.sqlite3', '.db',
                                              '.pt', '.pth', '.safetensors', '.ckpt', '.dump', '.backup'}):
                raise RuntimeError('Unsafe or private source archive category')
            seen.add(item.name)
            target = destination.joinpath(*parts)
            if item.isdir():
                target.mkdir(parents=True, exist_ok=True, mode=0o755); target.chmod(0o755)
                continue
            if item.name not in expected or item.size > 16*1024**2:
                raise RuntimeError('Unreviewed source member or byte bound')
            body = archive.extractfile(item).read()
            observed = command(['git', 'hash-object', '--stdin'], capture='binary', input_data=body).stdout.decode('ascii').strip()
            if observed != expected[item.name][1]:
                raise RuntimeError('Exact tracked Git blob identity differs')
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
            target.write_bytes(body); target.chmod(0o755 if expected[item.name][0] == '100755' else 0o644)
            hashes[item.name] = hashlib.sha256(body).hexdigest()
    if set(hashes) != set(expected):
        raise RuntimeError('Git export omitted a tracked source file')
    (destination/'ci/source-manifest.json').write_text(json.dumps({'files': hashes}, sort_keys=True)+'\n')
    (destination/'ci/source-manifest.json').chmod(0o644)
    return hashes


def verify_container(docker, name, image, source):
    fields = ['.Id', '.Config.Image', '.Config.User', '.HostConfig.NetworkMode', '.HostConfig.ReadonlyRootfs',
              '.HostConfig.CapDrop', '.HostConfig.SecurityOpt', '.HostConfig.Memory', '.HostConfig.MemorySwap',
              '.HostConfig.NanoCpus', '.HostConfig.PidsLimit', '.HostConfig.Privileged', '.HostConfig.Devices',
              '.HostConfig.PortBindings', '.Mounts', '.HostConfig.Tmpfs']
    values = [json.loads(line) for line in docker.call(['container', 'inspect', '--format',
              '\n'.join('{{json '+f+'}}' for f in fields), name]).stdout.splitlines()]
    tmpfs = {'/tmp': 'rw,nosuid,nodev,noexec,size=2g,mode=1777'}
    if REPOSITORY.endswith('/Italian-Learning-Portal'):
        tmpfs['/opt/ci-node/node_modules/.vite-temp'] = 'rw,nosuid,nodev,noexec,size=64m,mode=1777'
    if not (len(values) == 16 and values[1] == image and values[2] == '10001:10001'
            and values[3] == 'none' and values[4] is True and values[5] == ['ALL']
            and values[6] == ['no-new-privileges:true'] and values[7] == 4*1024**3
            and values[8] == values[7] and values[9] == 1000000000 and values[10] == 512
            and values[11] is False and not values[12] and not values[13]
            and len(values[14]) == 1 and values[14][0]['Type'] == 'bind'
            and values[14][0]['Source'] == str(source) and values[14][0]['Destination'] == '/input'
            and values[14][0]['RW'] is False and values[15] == tmpfs):
        raise RuntimeError('Owned container isolation or caps differ')


def main():
    os.umask(0o077)
    if len(sys.argv) not in (2, 3) or sys.argv[1] not in MODES or (len(sys.argv) == 3 and sys.argv[2] != '--cleanup'):
        raise RuntimeError('Exact maintained check mode required')
    mode = sys.argv[1]; cleanup_only = len(sys.argv) == 3
    revision, labels = trusted_context(mode)
    parent = Path(os.environ['RUNNER_TEMP'])
    if parent.is_symlink() or not parent.is_dir() or parent.stat().st_uid != os.getuid():
        raise RuntimeError('Owned runner temporary parent required')
    parent = parent.resolve(strict=True)
    if not cleanup_only:
        available = int(next(line.split()[1] for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:')))*1024
        if os.getloadavg()[0] >= 6 or available < 8*1024**3 or shutil.disk_usage(parent).free < 15*1024**3:
            raise RuntimeError('Fresh load/RAM/disk gate refused')
    temporary = Path(tempfile.mkdtemp(prefix=PREFIX+'-', dir=parent))
    identity = (temporary.stat().st_dev, temporary.stat().st_ino)
    def remove_temporary():
        current = temporary.lstat()
        if temporary.is_symlink() or current.st_uid != os.getuid() or (current.st_dev, current.st_ino) != identity:
            raise RuntimeError('Temporary root identity changed')
        shutil.rmtree(temporary)
    config = temporary/'docker-config'; config.mkdir(mode=0o700)
    docker = Docker(config)
    if cleanup_only:
        try:
            owned = []
            for kind, fmt in [('image', '{{.Repository}}:{{.Tag}}'), ('container', '{{.Names}}')]:
                args = [kind, 'ls', '--format', fmt]+(['-a'] if kind == 'container' else [])
                for key, value in labels.items(): args += ['--filter', 'label='+key+'='+value]
                owned.extend((kind, name) for name in docker.call(args).stdout.splitlines())
            cleanup(docker, owned, labels)
        finally:
            remove_temporary()
        return
    operation = uuid.uuid4().hex[:16]; labels['audit.ci.operation'] = operation
    image = PREFIX+'-'+operation+':runtime'; container = PREFIX+'-'+operation+'-test'
    owned = []; hashes = {}; build_started = build_finished = create_started = create_finished = False
    def stop(signum, frame): raise SystemExit(128+signum)
    for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP): signal.signal(sig, stop)
    try:
        dependency_inputs()
        docker_root = Path(docker.call(['info', '--format', '{{.DockerRootDir}}']).stdout.strip())
        if not docker_root.is_absolute() or shutil.disk_usage(docker_root).free < 20*1024**3:
            raise RuntimeError('Actual Docker-storage free-space gate refused')
        with (temporary/'operation.json').open('x') as record:
            json.dump({'labels': labels, 'image': image, 'container': container, 'revision': revision, 'mode': mode}, record)
            record.flush(); os.fsync(record.fileno())
        directory_fd = os.open(temporary, os.O_RDONLY)
        try: os.fsync(directory_fd)
        finally: os.close(directory_fd)
        source = temporary/'source'; source.mkdir(mode=0o755); source.chmod(0o755)
        hashes = export_source(source)
        if mode == 'history':
            bundle = source/'ci/history.bundle'
            command(['git', 'bundle', 'create', str(bundle), '--all'], timeout=120)
            if bundle.stat().st_size > 512*1024**2: raise RuntimeError('History bundle bound refused')
            bundle.chmod(0o644)
        context = temporary/'context'; context.mkdir(mode=0o700)
        for relative, destination in CONTEXT_FILES.items():
            original = ROOT/relative
            if original.is_symlink() or not original.is_file(): raise RuntimeError('Regular dependency source required')
            target = context/destination; target.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
            shutil.copyfile(original, target); target.chmod(0o644)
        if docker.inspect('image', image) is not None: raise RuntimeError('Fresh image tag already exists')
        owned.append(('image', image))
        args = ['build', '--platform', 'linux/amd64', '--pull=false', '--tag', image]
        for key, value in labels.items(): args += ['--label', key+'='+value]
        build_started = True
        try:
            docker.call(args+[str(context)], timeout=1200, capture=False)
        except subprocess.CalledProcessError:
            build_finished = True; raise
        else:
            build_finished = True
        obj = docker.inspect('image', image)
        if obj is None or not all(obj['labels'].get(k) == v for k, v in labels.items()):
            raise RuntimeError('Exact owned dependency image missing')
        if docker.inspect('container', container) is not None: raise RuntimeError('Fresh container name already exists')
        owned.append(('container', container))
        args = ['container', 'create', '--name', container, '--platform', 'linux/amd64', '--network', 'none',
                '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
                '--cpus', '1', '--memory', '4g', '--memory-swap', '4g', '--pids-limit', '512',
                '--user', '10001:10001', '--workdir', '/tmp',
                '--mount', 'type=bind,source='+str(source)+',target=/input,readonly',
                '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=2g,mode=1777']
        if REPOSITORY.endswith('/Italian-Learning-Portal'):
            args += ['--tmpfs', '/opt/ci-node/node_modules/.vite-temp:rw,nosuid,nodev,noexec,size=64m,mode=1777']
        for key, value in labels.items(): args += ['--label', key+'='+value]
        for value in ['HOME=/tmp/home', 'CI=true', 'LANG=C.UTF-8', 'PYTHONDONTWRITEBYTECODE=1',
                      'HF_HUB_OFFLINE=1', 'TRANSFORMERS_OFFLINE=1', 'HF_DATASETS_OFFLINE=1',
                      'HF_HUB_DISABLE_TELEMETRY=1', 'MPLBACKEND=Agg', 'MPLCONFIGDIR=/tmp/matplotlib',
                      'XDG_CACHE_HOME=/tmp/cache', 'OMP_NUM_THREADS=1', 'MKL_NUM_THREADS=1',
                      'OPENBLAS_NUM_THREADS=1', 'GIT_CONFIG_NOSYSTEM=1', 'GIT_CONFIG_GLOBAL=/dev/null',
                      'GIT_CONFIG_COUNT=1', 'GIT_CONFIG_KEY_0=core.hooksPath', 'GIT_CONFIG_VALUE_0=/dev/null',
                      'NEXT_TELEMETRY_DISABLED=1', 'WRANGLER_SEND_METRICS=false',
                      'PARLIAMO_ENABLE_PAID_AI=false']:
            args += ['--env', value]
        create_started = True
        docker.call(args+[obj['id'], 'python3', '-B', '/input/ci/checks.py', mode, revision], timeout=45)
        create_finished = True
        verify_container(docker, container, obj['id'], source)
        docker.call(['container', 'start', '--attach', container], timeout=1800, capture=False)
        code = docker.call(['container', 'inspect', '--format', '{{.State.ExitCode}}', container]).stdout.strip()
        if code != '0': raise RuntimeError('Maintained checks failed; no acceptance')
    finally:
        for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP): signal.signal(sig, signal.SIG_IGN)
        errors = []
        if build_started and not build_finished: errors.append('ImageBuildCompletionUnknown')
        if create_started and not create_finished: errors.append('ContainerCreateCompletionUnknown')
        try: cleanup(docker, owned, labels)
        except Exception as error: errors.append(type(error).__name__)
        try:
            for path, digest in hashes.items():
                if hashlib.sha256((ROOT/path).read_bytes()).hexdigest() != digest:
                    raise RuntimeError('Original tracked source changed')
        except Exception as error: errors.append(type(error).__name__)
        if errors: raise RuntimeError('Cleanup/preservation uncertain; keep operation journal: '+','.join(errors))
        remove_temporary()
    print(json.dumps({'status': 'maintained-offline-checks-passed', 'mode': mode,
                      'owned_cleanup_verified': True, 'original_source_preserved': True,
                      'provider_deployment_or_owner_data_accessed': False}))


if __name__ == '__main__':
    main()
