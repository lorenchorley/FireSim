(function() {
	//#region src/ui/speedTestKernels.ts
	/**
	* The two FROZEN kernels of the speed test and the clock that times them (0.7.0, item C; speedTest.ts has the words around them). Pure: no DOM, no
	* worker, no `Math.random` and no clock but the `now` the caller hands in, so the node tests pin the numbers and the worker, the main-thread fallback and the
	* reference measurement all run the same code.
	*
	*   K1 "air stencil": a 45 x 45 x 20 Float32 grid (the standard tier's air, 40,500 cells), each sweep a 7-point stencil and a trilinear gather at a
	*      displaced point for every interior cell (the two things the air step spends its time on), values and displacements from a fixed LCG seed.
	*   K2 "memory copy": a 16 MiB Float32 array copied into another by a plain loop, eight chunks a sweep.
	*
	* Frozen: `speedTest.kernels.test.ts` pins the checksum of K1 after 3 sweeps and of K2 after 2 sweeps from the fixed inputs. Any edit to a kernel (its
	* arithmetic, its sizes, its seed, the order it visits cells) changes those and must come with a new `SPEED_TEST_VERSION` and a new reference.
	*/
	/** The fixed seed of every input; the generator is a 32-bit LCG (Numerical Recipes constants), exact in integer arithmetic on every engine. */
	var SPEED_TEST_SEED = 20261030;
	/** The copy's array: 16 MiB of Float32, in this many chunks a sweep (a slice of the main-thread fallback can stop between chunks). */
	var COPY_FLOATS = 4194304;
	/** A 32-bit linear congruential generator: the next unit-interval float [0, 1) each call. */
	function lcg(seed) {
		let s = seed >>> 0;
		return () => {
			s = Math.imul(s, 1664525) + 1013904223 >>> 0;
			return s / 4294967296;
		};
	}
	function fnv(a) {
		const w = new Uint32Array(a.buffer, a.byteOffset, a.length);
		let h = 2166136261;
		for (let i = 0; i < w.length; i++) {
			h ^= w[i];
			h = Math.imul(h, 16777619) >>> 0;
		}
		return h;
	}
	/** K1. The displacements are under one cell, so the gather's eight corners are always inside the grid. */
	function makeStencilKernel() {
		const nx = 45;
		const nxy = 2025;
		const n = nxy * 20;
		const rnd = lcg(SPEED_TEST_SEED);
		let a = new Float32Array(n);
		let b = new Float32Array(n);
		const u = new Float32Array(n);
		const v = new Float32Array(n);
		const w = new Float32Array(n);
		for (let i = 0; i < n; i++) {
			a[i] = rnd();
			u[i] = .9 * (2 * rnd() - 1);
			v[i] = .9 * (2 * rnd() - 1);
			w[i] = .9 * (2 * rnd() - 1);
		}
		b.set(a);
		return {
			work: 33282,
			parts: 18,
			part(p) {
				const z = p + 1;
				for (let j = 1; j < 44; j++) for (let i = 1; i < 44; i++) {
					const c = z * nxy + j * nx + i;
					const around = a[c - 1] + a[c + 1] + a[c - nx] + a[c + nx] + a[c - nxy] + a[c + nxy];
					const x = i - u[c];
					const y = j - v[c];
					const s = z - w[c];
					const i0 = x | 0;
					const j0 = y | 0;
					const k0 = s | 0;
					const fx = x - i0;
					const fy = y - j0;
					const fz = s - k0;
					const o = k0 * nxy + j0 * nx + i0;
					const c0 = (a[o] * (1 - fx) + a[o + 1] * fx) * (1 - fy) + (a[o + nx] * (1 - fx) + a[o + nx + 1] * fx) * fy;
					const c1 = (a[o + nxy] * (1 - fx) + a[o + nxy + 1] * fx) * (1 - fy) + (a[o + nxy + nx] * (1 - fx) + a[o + nxy + nx + 1] * fx) * fy;
					b[c] = .88 * (c0 * (1 - fz) + c1 * fz) + .02 * around;
				}
			},
			end() {
				const t = a;
				a = b;
				b = t;
			},
			values: () => a,
			checksum: () => fnv(a)
		};
	}
	/** K2. Each sweep copies the whole array, swaps the two and adds 1 to the first float, so the state depends on the number of sweeps. */
	function makeCopyKernel() {
		const rnd = lcg(1524941107);
		let src = new Float32Array(COPY_FLOATS);
		let dst = new Float32Array(COPY_FLOATS);
		for (let i = 0; i < COPY_FLOATS; i++) src[i] = rnd();
		const chunk = COPY_FLOATS / 8;
		return {
			work: COPY_FLOATS * 4,
			parts: 8,
			part(p) {
				const to = (p + 1) * chunk;
				for (let i = p * chunk; i < to; i++) dst[i] = src[i];
			},
			end() {
				const t = src;
				src = dst;
				dst = t;
				src[0] = src[0] + 1;
			},
			values: () => src,
			checksum: () => fnv(src)
		};
	}
	/** Run `sweeps` whole sweeps (no clock): what the checksum test and a warm-up call use. */
	function sweeps(k, count) {
		for (let s = 0; s < count; s++) {
			for (let p = 0; p < k.parts; p++) k.part(p);
			k.end();
		}
	}
	/**
	* Times one kernel: warm-up sweeps for `warmMs`, then timed sweeps for `timeMs`, each phase ended at a sweep boundary (so only whole sweeps are counted).
	* `step` can be called again after it returns false: the main-thread fallback runs it in slices and `now` is read only to measure the running time inside
	* each slice, so the time spent waiting between slices is not in the score.
	*/
	var KernelTimer = class {
		kernel;
		warmMs;
		timeMs;
		phase = "warm";
		part = 0;
		base = 0;
		count = 0;
		timedMs = 0;
		constructor(kernel, warmMs = 200, timeMs = 800) {
			this.kernel = kernel;
			this.warmMs = warmMs;
			this.timeMs = timeMs;
		}
		/** Runs until the kernel is timed (true) or, when `sliceMs` is given, until that long has passed in this call, checked between parts (false). */
		step(now, sliceMs = Infinity) {
			const sliceStart = now();
			let t0 = sliceStart;
			let before = this.base;
			while (this.phase !== "done") {
				this.kernel.part(this.part);
				const t = now();
				const phaseMs = before + (t - t0);
				if (++this.part === this.kernel.parts) {
					this.part = 0;
					this.kernel.end();
					if (this.phase === "timed") this.count++;
					if (phaseMs >= (this.phase === "warm" ? this.warmMs : this.timeMs)) {
						if (this.phase === "timed") {
							this.timedMs = phaseMs;
							this.phase = "done";
							return true;
						}
						this.phase = "timed";
						t0 = t;
						before = 0;
					}
				}
				if (t - sliceStart >= sliceMs) {
					this.base = before + (t - t0);
					return false;
				}
			}
			return true;
		}
		/** The kernel's work a second (work units: cell updates, or bytes), or 0 until it is timed. */
		rate() {
			return this.phase === "done" && this.timedMs > 0 ? this.count * this.kernel.work / (this.timedMs / 1e3) : 0;
		}
	};
	/** K1 then K2 to the end in one go (the worker's job, and the reference measurement's). `now` is `performance.now`. */
	function measureAll(now) {
		const k1 = new KernelTimer(makeStencilKernel());
		k1.step(now);
		const k2 = new KernelTimer(makeCopyKernel());
		k2.step(now);
		return {
			stencilMcellsPerS: k1.rate() / 1e6,
			copyGBps: k2.rate() / 1e9
		};
	}
	//#endregion
	//#region prototypes/dotnet-b/harness/speedtest-worker.entry.ts
	/**
	* Round 0's worker (plan T0.6b): the two FROZEN speed-test kernels of the app (`src/ui/speedTestKernels.ts`, imported unchanged) in a classic worker, run the way the
	* app's own speed test runs them (`src/ui/speedTest.worker.ts`: one message, `measureAll(performance.now)`, which warms each kernel 200 ms and times it 800 ms at sweep
	* boundaries), followed by the two checksum runs of `src/ui/speedTest.test.ts` (K1 after 3 sweeps, K2 after 2 sweeps, from fresh kernels, so they cannot disturb the timing).
	* Built to `Fs.TestApp/Resources/Raw/wwwroot/speedtest.worker.js` by `harness/build-speedtest.sh`.
	*
	* Message in:  anything (the app's worker also answers any message).   Message out: the object below, or { error } if something throws.
	*/
	var hex8 = (x) => "0x" + (x >>> 0).toString(16).padStart(8, "0");
	var scope = self;
	scope.onmessage = () => {
		try {
			const t0 = performance.now();
			const raw = measureAll(() => performance.now());
			const t1 = performance.now();
			const k1 = makeStencilKernel();
			sweeps(k1, 3);
			const k2 = makeCopyKernel();
			sweeps(k2, 2);
			const t2 = performance.now();
			scope.postMessage({
				stencilMcellsPerS: raw.stencilMcellsPerS,
				copyGBps: raw.copyGBps,
				stencilAfter3: hex8(k1.checksum()),
				copyAfter2: hex8(k2.checksum()),
				measureMs: t1 - t0,
				verifyMs: t2 - t1,
				warmMs: 200,
				timeMs: 800,
				kernelsSha256: "6ebe574a58acafeccdc9291c880c0d86da67b86a5cb53c7bd5d4fc7edf03aee7"
			});
		} catch (e) {
			scope.postMessage({ error: String(e && e.stack ? e.stack : e).slice(0, 1e3) });
		}
	};
	//#endregion
})();
