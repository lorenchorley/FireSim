# Notices for the FdLibm implementation in `Fs.Kernel/FsMath.cs`

`FsMath.FdLibm` is a managed (C#) port of the fdlibm algorithms **as compiled into V8 12.4** (Node 22), from `src/base/ieee754.cc` at tag `12.4.254.21` of
<https://github.com/v8/v8> (SHA-256 of the file as fetched: `da01a54955911cfc550117988de91516c6f1aac343af28142dce619b433a67fc`; V8's `LICENSE` at the same tag:
`81680185f0cb339021e3b73714499264de72f33b17cfdb0c14f400de6d95cf0e`). `FsMath.V8Hypot` is a port of `MathHypot` in `src/builtins/math.tq` at the same tag
(`569ff61e5bc48f6121fa57dcdaa8ba56428231a8d1091d2c5193332e4fbf18ff`).

## fdlibm (Sun Microsystems)

```
====================================================
Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.

Developed at SunSoft, a Sun Microsystems, Inc. business.
Permission to use, copy, modify, and distribute this
software is freely granted, provided that this notice
is preserved.
====================================================
```

V8's file adds: "The original source code covered by the above license above has been modified significantly by Google Inc. Copyright 2016 the V8 project authors. All rights reserved."

## V8 (Google), BSD 3-clause

```
Copyright 2014, the V8 project authors. All rights reserved.
Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above
      copyright notice, this list of conditions and the following
      disclaimer in the documentation and/or other materials provided
      with the distribution.
    * Neither the name of Google Inc. nor the names of its
      contributors may be used to endorse or promote products derived
      from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```
