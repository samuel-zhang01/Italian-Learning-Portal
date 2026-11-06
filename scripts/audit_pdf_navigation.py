"""Verify linked PDF targets, original page rendering, and portal registration."""
import json

import pymupdf as fitz
import link_book_pdfs as nav


def main():
    report = nav.base.read_json(nav.DEST / 'navigation-manifest.json', nav.DEST)
    catalogue = json.loads((nav.base.ROOT / 'app/learning/pdf-bundles.json').read_text())
    bundles = {item['sha256']: item for item in catalogue}
    totals = {'pdfs': 0, 'links': 0, 'renderedPagesCompared': 0, 'portalMappings': 0}
    checks = []
    for item in report['outputs']:
        path = nav.base.private(nav.base.ROOT / item['path'], nav.DEST)
        source = nav.base.private(nav.base.ROOT / item['source']['path'], nav.base.EXPORTS)
        assert nav.base.digest(path) == item['sha256'], 'Linked PDF checksum changed'
        assert nav.base.digest(source) == item['source']['sha256'], 'Original PDF checksum changed'
        with fitz.open(source) as original, fitz.open(path) as linked:
            assert len(linked) == item['pages']
            assert len(original) == item['sourcePages']
            assert nav.validate(linked) == item['internalLinks']
            for number in range(len(original)):
                links = linked[number].get_links()
                assert links[0]['page'] == len(original), 'Missing return to contents'
                assert all(link['from'].y0 >= original[number].rect.height for link in links)
            linked_toc = {tuple(entry) for entry in linked.get_toc()}
            for entry in original.get_toc():
                assert tuple(entry) in linked_toc, 'Original bookmark changed'
            # Every section boundary, plus beginning/middle/end, gets a text check.
            boundaries = {entry[2] - 1 for entry in original.get_toc() if entry[2] > 0}
            samples = {0, len(original) // 4, len(original) // 2, len(original) * 3 // 4, len(original) - 1}
            for number in sorted(boundaries | samples):
                before, after = original[number], linked[number]
                assert before.get_text() == after.get_text(clip=before.rect), 'Source text changed'
            for number in sorted(samples):
                before, after = original[number], linked[number]
                # Render the full original page area, including the old bottom edge.
                assert before.get_pixmap().samples == after.get_pixmap(clip=before.rect).samples, 'Source pixels changed'
            mapping = bundles.get(item['sha256'])
            old_mapping = bundles.get(item['source']['sha256'])
            if old_mapping:
                assert mapping and mapping['sources'] == old_mapping['sources'], 'Portal offsets changed'
            if mapping:
                assert mapping['pages'] == len(linked)
                assert all(entry['offset'] + entry['pages'] <= len(original) for entry in mapping['sources'])
                totals['portalMappings'] += 1
            totals['pdfs'] += 1
            totals['links'] += item['internalLinks']
            totals['renderedPagesCompared'] += len(samples)
            checks.append({'file': path.name, 'textPagesCompared': len(boundaries | samples), 'renderedPagesCompared': len(samples)})
            print(json.dumps({'file': path.name, 'verified': True}), flush=True)
    safe_path = nav.base.ROOT / 'docs/pdf-navigation-audit.json'
    safe = json.loads(safe_path.read_text())
    safe['validation'] = {**totals, 'allLinkTargetsValid': True, 'allSourcePageReturnLinksValid': True,
                          'sampledSourceRenderingIdentical': True, 'originalBookmarksPreserved': True,
                          'originalPDFHashesUnchanged': True, 'checks': checks}
    safe_path.write_text(json.dumps(safe, indent=2) + '\n')
    print(json.dumps(totals), flush=True)


if __name__ == '__main__':
    main()
