#!/usr/bin/env python3
"""T1.3: correctly rounded reference values, from mpmath at 400 bits.

    python3 -I Fs.Bench/fsmath/cr-reference.py GOLDEN.json [DIR_OF_MPMATH]      adds "cr" (16 hex digits per call) to the golden file
    (cr-check.py imports cr_double from here)

Method: mpmath (pure Python, BSD) computes the function at 400 bits of precision; the result is rounded to the nearest double (ties to even, also in the
subnormal range, overflow to infinity) by exact rational conversion: Python's int / int true division is correctly rounded. A result within 2^-340 relative of
a rounding boundary and not exactly representable would be rounded wrongly; no call of the golden file is such a case (exact cases such as exp(0), pow(2, 10),
log2(8), cbrt(27) come out of mpmath exactly, or so close to the exact value that the rounding gives it). mpf has no negative zero: the signs of zero results
and the quadrants of atan2(+-0, x) are taken from the signs of the arguments. Needs mpmath: `pip install --target DIR mpmath`, then pass DIR (python -I ignores
PYTHONPATH).
"""
import json
import math
import struct
import sys
from fractions import Fraction

if __name__ == '__main__' and len(sys.argv) > 2:
    sys.path.insert(0, sys.argv[2])
import mpmath
from mpmath import mp, mpf

mp.prec = 400


def to_double(r):
    """Correctly rounded double of the mpf r (round half to even; subnormals and overflow handled by the exact division)."""
    if r == 0:
        return 0.0
    sign, man, exp, bc = r._mpf_
    q = Fraction(int(man)) * (Fraction(2) ** int(exp))
    if sign:
        q = -q
    try:
        return float(q)  # int/int true division is correctly rounded
    except OverflowError:
        return float('-inf') if q < 0 else float('inf')


def from_hex(h):
    return struct.unpack('<d', struct.pack('<Q', int(h, 16)))[0]


def to_hex(x):
    return format(struct.unpack('<Q', struct.pack('<d', x))[0], '016x')


def neg(v):
    return math.copysign(1.0, v) < 0


def exact(fn, a):
    """The function at the arguments a (floats) as an mpf, +-inf, or None when the exponent is certain to overflow or underflow (decided by the caller)."""
    x = [mpf(v) for v in a]
    if fn == 'exp':
        return mpmath.exp(x[0]) if x[0] > -800 else mpf(0)
    if fn == 'log':
        return mpmath.log(x[0])
    if fn == 'log2':
        return mpmath.log(x[0]) / mpmath.log(2)
    if fn == 'log10':
        return mpmath.log(x[0]) / mpmath.log(10)
    if fn == 'pow':
        if x[0] == 0:
            odd = x[1] == int(x[1]) and int(x[1]) % 2 != 0
            if x[1] > 0:
                return mpf(0)  # the sign of a zero result is applied by the caller
            return mpf('-inf') if (odd and neg(a[0])) else mpf('inf')
        return mpmath.power(x[0], x[1]) if abs(x[1] * mpmath.log(abs(x[0]))) < 800 else None
    if fn == 'sin':
        return mpmath.sin(x[0])
    if fn == 'cos':
        return mpmath.cos(x[0])
    if fn == 'tan':
        return mpmath.tan(x[0])
    if fn == 'atan':
        return mpmath.atan(x[0])
    if fn == 'atan2':
        if a[0] == 0:  # the quadrant of +-0 comes from the signs of the two floats
            if not (a[1] < 0 or (a[1] == 0 and neg(a[1]))):
                return mpf(0)
            return -mpmath.pi if neg(a[0]) else mpmath.pi
        return mpmath.atan2(x[0], x[1])
    if fn == 'acos':
        return mpmath.acos(x[0])
    if fn == 'asin':
        return mpmath.asin(x[0])
    if fn == 'sinh':
        return mpmath.sinh(x[0]) if abs(x[0]) < 800 else None
    if fn == 'cbrt':
        return mpmath.cbrt(x[0]) if x[0] >= 0 else -mpmath.cbrt(-x[0])
    if fn == 'hypot':
        return mpmath.hypot(x[0], x[1])
    raise ValueError(fn)


def cr_double(fn, a):
    """The correctly rounded double of fn(*a) for finite arguments a (a list of floats). Raises ValueError outside the real domain (the result is NaN)."""
    r = exact(fn, a)
    if r is None:  # beyond +-800 in the exponent: overflow or underflow; the sign comes from the exact result
        if fn == 'pow':
            big = abs(a[0]) > 1 and a[1] > 0 or abs(a[0]) < 1 and a[1] < 0
            r = mpf('inf') if big else mpf(0)
            if big and neg(a[0]) and a[1] == int(a[1]) and int(a[1]) % 2 != 0:
                r = -r
        else:  # sinh
            r = mpf('inf') if a[0] > 0 else mpf('-inf')
    if isinstance(r, mpmath.mpc):
        raise ValueError('complex result')
    if r == mpf('inf'):
        y = float('inf')
    elif r == mpf('-inf'):
        y = float('-inf')
    else:
        y = to_double(r)
    # signed zero results: the sign of the argument (odd functions), of the base (pow with an odd integer exponent), of y (atan2)
    if y == 0.0:
        if fn in ('sin', 'tan', 'atan', 'asin', 'sinh', 'cbrt') and neg(a[0]):
            y = -0.0
        elif fn == 'atan2' and a[0] == 0 and neg(a[0]):
            y = -0.0
        elif fn == 'pow' and neg(a[0]) and a[1] == int(a[1]) and int(a[1]) % 2 != 0:
            y = -0.0
    return y


if __name__ == '__main__':
    path = sys.argv[1]
    data = json.load(open(path))
    for fn, v in data['functions'].items():
        arity = v['arity']
        xs = [from_hex(h) for h in v['x']]
        v['cr'] = [to_hex(cr_double(fn, xs[arity * i: arity * i + arity])) for i in range(v['calls'])]
    json.dump(data, open(path, 'w'))
    print('cr written for', ', '.join(f"{k}:{v['calls']}" for k, v in data['functions'].items()))
