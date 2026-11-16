#!/usr/bin/env python3
"""Fills the generated tables into the report template: python3 assemble.py TEMPLATE.md DIR OUT.md
DIR holds summary.md (summarize.mjs output), areas.md (areas.mjs --functions output), waterfall.md (waterfall.mjs output) and
the sites file prototypes/dotnet-b/reports/3-slice-sites.md (summarize.mjs --sites). Kept so that the report can be regenerated."""
import re
import sys

tpl, d, out = sys.argv[1], sys.argv[2], sys.argv[3]
sites_path = 'prototypes/dotnet-b/reports/3-slice-sites.md'


def section(text, title_start, level='## '):
    """Body of the section whose heading starts with title_start, up to the next heading of the same level."""
    m = re.search(r'^' + re.escape(level + title_start) + r'.*?$', text, re.M)
    if not m:
        raise SystemExit('missing section ' + title_start)
    rest = text[m.end():]
    n = re.search(r'^' + re.escape(level) + r'(?!#)', rest, re.M)
    return rest[:n.start()] if n else rest


summary = open(f'{d}/summary.md').read()
areas = open(f'{d}/areas.md').read()
water = open(f'{d}/waterfall.md').read()
sites = open(sites_path).read()

parts = {}
parts['MATH_FN'] = section(summary, 'Math call sites by function').strip()
parts['MATH_FILE'] = section(summary, 'Math sites by file').strip()
parts['POW'] = section(summary, '`**` sites').strip()
parts['TA'] = section(summary, 'Typed-array stores by array kind and file').strip()
parts['BITS'] = '**Bit operations (ToInt32 / ToUint32), by file:**\n\n' + section(summary, 'Bit operations').strip()
parts['WATERFALL'] = water.split('\nper file')[0].strip()
parts['AREA_TABLE'] = areas.replace('\n### ', '\n#### ').strip()


def sites_section(title, limit=None):
    body = section(sites, title).strip().splitlines()
    return '\n'.join(body)


parts['SORTS'] = sites_section('sort / reverse')
parts['MAPITER'] = sites_section('Map / Set iteration')
parts['RNG'] = sites_section('Rng calls')

text = open(tpl).read()
for k, v in parts.items():
    text = text.replace('{{' + k + '}}', v)
left = re.findall(r'\{\{[A-Z_]+\}\}', text)
if left:
    raise SystemExit('unfilled: ' + ', '.join(left))
open(out, 'w').write(text)
