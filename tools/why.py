# Why did ILLink keep X? Shortest dependency chain from a root to each target, from linker-dependencies.xml.
# Usage: python3 tools/why.py <linker-dependencies.xml> <substring>...
import sys, re, collections
f, targets = sys.argv[1], sys.argv[2:]
rev = collections.defaultdict(list); nodes = set(); begins = set()
pat = re.compile(r'<edge mark="\d+" b="([^"]*)" e="([^"]*)"')
for line in open(f, encoding='utf-8-sig'):
    m = pat.search(line)
    if not m: continue
    b, e = m.group(1), m.group(2)
    rev[e].append(b); nodes.add(e); begins.add(b)
roots = begins - nodes
def path_to(t):
    # BFS backwards from t until a root
    prev = {t: None}; q = collections.deque([t])
    while q:
        n = q.popleft()
        if n.startswith(('Assembly:', 'Other:')) or (n in roots and n.startswith('Method:')):
            out = []
            while n is not None: out.append(n); n = prev[n]
            return out
        for p in rev[n]:
            if p not in prev: prev[p] = n; q.append(p)
    return [t, '(no root found)']
for t in targets:
    cands = sorted(n for n in nodes if t in n and n.startswith('TypeDef:'))[:1] or sorted(n for n in nodes if t in n)[:1]
    if not cands: print(f'### {t}: not kept'); continue
    print(f'### {cands[0]}')
    for i, n in enumerate(path_to(cands[0])): print('  ' + '  ' * min(i, 12) + n.replace('&lt;', '<').replace('&gt;', '>')[:220])
