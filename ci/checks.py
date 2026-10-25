"""Verify the maintained daily site using fresh local state."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys


def require(condition, message):
    if not condition: raise RuntimeError(message)


def main():
    require(len(sys.argv) == 3 and sys.argv[1] == 'verify', 'Exact verification mode required')
    require(os.getuid() == os.geteuid() == 10001 and os.getgid() == 10001, 'Non-root identity required')
    status = dict(line.split(':', 1) for line in Path('/proc/self/status').read_text().splitlines() if ':' in line)
    require(int(status['CapEff'], 16) == 0 and status['NoNewPrivs'].strip() == '1'
            and status['Seccomp'].strip() == '2', 'Kernel restrictions missing')
    limits = {p: (Path('/sys/fs/cgroup')/p).read_text().strip() for p in ('cpu.max', 'memory.max', 'pids.max')}
    quota, period = map(int, limits['cpu.max'].split())
    require(quota == period and quota > 0 and limits['memory.max'] == str(4*1024**3)
            and limits['pids.max'] == '512', 'Effective cgroup limits missing')
    require(not any(line.split()[1] == '00000000' for line in Path('/proc/net/route').read_text().splitlines()[1:]),
            'External network route forbidden')
    require(not any(key in os.environ for key in ('OPENAI_API_KEY', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_KEY', 'GITHUB_TOKEN')),
            'Provider credentials forbidden')
    require(shutil.which('docker') is None, 'Docker authority forbidden')
    require(subprocess.check_output(['node', '--version'], text=True).strip() == 'v22.22.2', 'Exact Node required')
    source = Path('/input'); work = Path('/tmp/work'); Path('/tmp/home').mkdir(mode=0o700)
    require(not any((source/p).exists() for p in ('.git', '.env', '.wrangler', 'backups/local-data')), 'Owner state forbidden')
    manifest = json.loads((source/'ci/source-manifest.json').read_text())['files']
    shutil.copytree(source, work)
    (work/'node_modules').symlink_to('/opt/ci-node/node_modules', target_is_directory=True)
    package = json.loads((work/'package.json').read_text())
    expected = {'lint': 'eslint .',
                'typecheck': 'tsc --noEmit',
                'build:daily': 'node scripts/generate_planning_metadata.mjs && vite build --config vite.static.config.ts && cp public/favicon.svg site-dist/favicon.svg',
                'test:daily': 'node scripts/generate_planning_metadata.mjs --check && node --experimental-strip-types --test tests/learning.test.mjs tests/academy.test.mjs tests/arcade.test.mjs tests/answer-contract.test.mjs tests/long-course.test.mjs tests/local-pdfs.test.mjs tests/book-media.test.mjs tests/blink-study-captions.test.mjs tests/discovery.test.mjs tests/chapter-content.test.mjs tests/chapter-continuity.test.mjs tests/planning-metadata.test.mjs tests/chapter-dashboard.test.mjs tests/review-queue.test.mjs tests/book-gaps.test.mjs tests/learning-insights.test.mjs tests/listening.test.mjs tests/backup-merge.test.mjs tests/offline-build.test.mjs'}
    require(all(package['scripts'].get(key) == value for key, value in expected.items()), 'Maintained command changed')
    require(not any(key in package['scripts'] for name in expected for key in ('pre'+name, 'post'+name)),
            'New lifecycle script requires review')
    def preserve():
        for relative, digest in manifest.items():
            require(hashlib.sha256((source/relative).read_bytes()).hexdigest() == digest
                    and hashlib.sha256((work/relative).read_bytes()).hexdigest() == digest,
                    'Original tracked source changed')
    preserve(); outcomes = {}; test_output = ''
    for name in expected:
        result = subprocess.run(['npm', 'run', name], cwd=work, timeout=480,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        print(result.stdout, end='', flush=True)
        outcomes[name] = result.returncode
        if name == 'test:daily': test_output = result.stdout
    # All daily engine/content cases must actually execute, not skip.
    totals = {name: re.findall(r'^# '+name+r' (\d+)\s*$', test_output, re.MULTILINE)
              for name in ('tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo')}
    require(all(len(value) == 1 for value in totals.values()), 'Node test accounting missing or ambiguous')
    totals = {name: int(value[0]) for name, value in totals.items()}
    require(all(code == 0 for code in outcomes.values()) and totals['tests'] >= 225
            and totals['pass'] == totals['tests'] and all(totals[key] == 0 for key in ('fail', 'cancelled', 'skipped', 'todo')),
            'All maintained daily commands and tests must pass without skips')
    output = work/'site-dist'
    artifacts = [path for path in output.rglob('*') if path.is_file()]
    require((output/'index.html').is_file() and (output/'favicon.svg').is_file()
            and any(path.suffix == '.js' for path in artifacts)
            and any(path.suffix == '.css' for path in artifacts), 'Daily deployment artifacts missing')
    require(not any(path.is_symlink() for path in output.rglob('*'))
            and all(path.suffix in {'.html', '.svg', '.webp', '.js', '.css', '.webmanifest'} for path in artifacts),
            'Unexpected daily deployment content')
    preserve()
    print(json.dumps({'maintained_commands': outcomes, 'node_tests': totals, 'accepted': True,
                      'uid': 10001, 'caps': 0, 'no_new_privs': 1, 'seccomp': 2, 'cgroup': limits,
                      'external_route': False, 'original_source_preserved': True,
                      'owner_learner_data_provider_or_deployment': False}))


if __name__ == '__main__': main()
