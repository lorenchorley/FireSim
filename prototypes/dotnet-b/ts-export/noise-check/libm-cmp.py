import ctypes, struct, array, sys, platform
d = sys.argv[1]; N = 200000
libm = ctypes.CDLL('libm.so.6')
def f(name, ar):
    fn = getattr(libm, name); fn.restype = ctypes.c_double; fn.argtypes = [ctypes.c_double] * ar; return fn
fns = {n: (1, f(n, 1)) for n in ['exp','log','sin','cos','tan','atan','cbrt','asin','acos','sinh','log2','log10','sqrt']}
fns['pow'] = (2, f('pow', 2)); fns['atan2'] = (2, f('atan2', 2)); fns['hypot'] = (2, f('hypot', 2))
print('python', platform.python_version(), 'libc', platform.libc_ver())
def ld(p):
    a = array.array('d'); a.frombytes(open(p, 'rb').read()); return a
def ib(x): return struct.unpack('<q', struct.pack('<d', x))[0]
def ulp(a, b):
    if a == b: return 0
    if a != a or b != b: return 1 << 60
    return abs(ib(a) - ib(b))
for name, (ar, fn) in fns.items():
    xs = ld(f'{d}/{name}.in'); ys = ld(f'{d}/{name}.v8'); hist = {}
    for i in range(N):
        r = fn(*[xs[ar * i + k] for k in range(ar)]); u = ulp(r, ys[i])
        if u: hist[u] = hist.get(u, 0) + 1
    tot = sum(hist.values())
    print(f'{name:6s} differ {100.0*tot/N:6.2f} % of {N}; ulp sizes: ' + ', '.join(f'{k}:{v}' for k, v in sorted(hist.items())) + f'; max {max(hist) if hist else 0}')
