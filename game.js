const loading = document.getElementById("loading");
const canvas = document.getElementById("canvas");
const musicChoice = document.getElementById("music-choice");

// ============================================================
// Loading UI
// ============================================================

const loadingUI = document.createElement("div");

loadingUI.innerHTML = `
	<div id="load-title" style="
		font-size:1.5rem;
		margin-bottom:.25rem;
	">Starting...</div>

	<div id="content-load" style="width:min(520px,80vw);">
		<div id="content-label" style="
			font-size:.9rem;
			opacity:.8;
			margin-bottom:.35rem;
		">Game content</div>

		<div style="
			width:100%;
			height:12px;
			background:rgba(255,255,255,.15);
			border-radius:999px;
			overflow:hidden;
		">
			<div id="content-bar" style="
				width:0%;
				height:100%;
				background:#fff;
				border-radius:999px;
				transition:width .15s ease;
			"></div>
		</div>
	</div>

	<div id="runtime-load" style="width:min(520px,80vw);">
		<div id="runtime-label" style="
			font-size:.9rem;
			opacity:.8;
			margin-bottom:.35rem;
		">Game runtime</div>

		<div style="
			width:100%;
			height:12px;
			background:rgba(255,255,255,.15);
			border-radius:999px;
			overflow:hidden;
		">
			<div id="runtime-bar" style="
				width:0%;
				height:100%;
				background:#fff;
				border-radius:999px;
				transition:width .15s ease;
			"></div>
		</div>
	</div>
`;

loading.appendChild(loadingUI);

const loadTitle = document.getElementById("load-title");

const contentLabel =
	document.getElementById("content-label");

const contentBar =
	document.getElementById("content-bar");

const runtimeLabel =
	document.getElementById("runtime-label");

const runtimeBar =
	document.getElementById("runtime-bar");

function setTitle(text) {
	loadTitle.textContent = text;
}

function setContentProgress(
	fraction,
	text
) {
	const percent =
		Math.max(
			0,
			Math.min(1, fraction)
		) * 100;

	contentBar.style.width =
		`${percent}%`;

	if (text)
		contentLabel.textContent =
			text;
}

function setRuntimeProgress(
	fraction,
	text
) {
	const percent =
		Math.max(
			0,
			Math.min(1, fraction)
		) * 100;

	runtimeBar.style.width =
		`${percent}%`;

	if (text)
		runtimeLabel.textContent =
			text;
}

// ============================================================
// Error reporting
// ============================================================

function showLoadError(error) {
	console.error(error);

	setTitle("Game failed to load");

	contentLabel.textContent =
		error?.message ||
		String(error);

	runtimeLabel.textContent =
		"Check the browser console for details.";

	contentBar.style.width = "0%";
	runtimeBar.style.width = "0%";
}

window.addEventListener(
	"error",
	(event) => {
		if (event.error)
			showLoadError(
				event.error
			);
	}
);

window.addEventListener(
	"unhandledrejection",
	(event) => {
		showLoadError(
			event.reason
		);
	}
);

// ============================================================
// OPFS helpers
// ============================================================

const opfs =
	await navigator.storage.getDirectory();

void navigator.storage.persist?.()
	.catch(() => false);

async function opfsHas(name) {
	try {
		await opfs.getFileHandle(name);
		return true;
	} catch {
		return false;
	}
}

async function opfsRead(name) {
	return new Uint8Array(
		await (
			await (
				await opfs.getFileHandle(name)
			).getFile()
		).arrayBuffer()
	);
}

// ============================================================
// Chunk helpers
// ============================================================

async function fetchChunkCount(url) {
	const response =
		await fetch(url);

	if (!response.ok)
		throw new Error(
			`Failed to fetch ${url}: HTTP ${response.status}`
		);

	const text =
		(await response.text()).trim();

	if (
		!/^\d+$/.test(text) ||
		Number(text) < 1
	) {
		throw new Error(
			`Invalid chunk count in ${url}: ${JSON.stringify(text)}`
		);
	}

	return Number(text);
}

// ============================================================
// Chunked tar download
// ============================================================

async function readTarChunks(
	base,
	label,
	writeChunk,
	progressType
) {
	setTitle(
		`Downloading ${label}...`
	);

	const count =
		await fetchChunkCount(
			base + ".count"
		);

	let total = 0;

	for (
		let i = 0;
		i < count;
		i++
	) {
		const res =
			await fetch(
				`${base}${String(i).padStart(2, "0")}`
			);

		if (!res.ok)
			throw new Error(
				`Failed to fetch ${res.url}: HTTP ${res.status}`
			);

		if (!res.body)
			throw new Error(
				`Streaming response body unavailable for ${res.url}`
			);

		const reader =
			res.body.getReader();

		let chunkBytes = 0;

		for (;;) {
			const {
				done,
				value
			} = await reader.read();

			if (done)
				break;

			await writeChunk(value);

			total += value.length;
			chunkBytes += value.length;

			const partial =
				Math.min(
					0.95,
					chunkBytes /
						Math.max(
							chunkBytes,
							1
						)
				);

			const fraction =
				(i + partial) / count;

			if (
				progressType ===
				"content"
			) {
				setContentProgress(
					fraction,
					`${label} — ${(total / 1048576) | 0} MB`
				);
			}
		}

		if (
			progressType ===
			"content"
		) {
			setContentProgress(
				(i + 1) / count,
				`${label} — chunk ${i + 1}/${count}`
			);
		}
	}

	return total;
}

// ============================================================
// Memory-based archive loading
// ============================================================

async function downloadTarToMemory(
	base,
	label
) {
	const initialSize =
		70 * 1024 * 1024;

	let tar =
		new Uint8Array(
			initialSize
		);

	let offset = 0;

	await readTarChunks(
		base,
		label,
		(chunk) => {
			if (
				offset + chunk.length >
				tar.length
			) {
				let newSize =
					tar.length;

				while (
					newSize <
					offset +
						chunk.length
				) {
					newSize *= 2;
				}

				const next =
					new Uint8Array(
						newSize
					);

				next.set(tar);

				tar = next;
			}

			tar.set(
				chunk,
				offset
			);

			offset +=
				chunk.length;
		},
		"content"
	);

	setContentProgress(
		1,
		`${label} loaded`
	);

	return tar.subarray(
		0,
		offset
	);
}

// ============================================================
// Initial content load bypasses OPFS
// ============================================================

async function getTar(
	base,
	label,
	key
) {
	return await downloadTarToMemory(
		base,
		label
	);
}

// ============================================================
// Music choice
// ============================================================

const audioCached =
	await opfsHas(
		"ContentAudio.tar"
	);

const wantMusic =
	audioCached ||
	(await new Promise(
		(resolve) => {
			musicChoice.style.display =
				"";

			document
				.getElementById(
					"btn-no-music"
				)
				.onclick = () => {
					musicChoice.style.display =
						"none";

					resolve(false);
				};

			document
				.getElementById(
					"btn-with-music"
				)
				.onclick = () => {
					musicChoice.style.display =
						"none";

					resolve(true);
				};
		}
	));

musicChoice.style.display =
	"none";

// ============================================================
// Runtime loading
// ============================================================

let runtimeChunkCount = 0;
let runtimeChunkLoaded = 0;

const runtimeP =
	(async () => {
		setRuntimeProgress(
			0,
			"Loading .NET runtime..."
		);

		const {
			dotnet
		} = await import(
			"./_framework/dotnet.js"
		);

		return dotnet
			.withModuleConfig({
				canvas
			})
			.withEnvironmentVariable(
				"MONO_SLEEP_ABORT_LIMIT",
				"99999"
			)
			.withRuntimeOptions([
				`--jiterpreter-minimum-trace-hit-count=${500}`,
				`--jiterpreter-trace-monitoring-period=${100}`,
				`--jiterpreter-trace-monitoring-max-average-penalty=${150}`,
				`--jiterpreter-trace-monitoring-max-average-penalty=${150}`,
				`--jiterpreter-wasm-bytes-limit=${64 * 1024 * 1024}`,
				`--jiterpreter-table-size=${32 * 1024}`,
			])
			.withResourceLoader(
				(
					type,
					_name,
					defaultUri,
					_integrity,
					behavior
				) => {
					if (
						type !==
							"dotnetwasm" ||
						behavior !==
							"dotnetwasm"
					) {
						return;
					}

					return (async () => {
						runtimeChunkCount =
							await fetchChunkCount(
								defaultUri +
									".count"
							);

						runtimeChunkLoaded =
							0;

						setRuntimeProgress(
							0,
							`.NET runtime — 0/${runtimeChunkCount} chunks`
						);

						let idx = 0;

						const fetchNext =
							async () => {
								if (
									idx >=
									runtimeChunkCount
								) {
									return null;
								}

								const uri =
									defaultUri +
									idx;

								const res =
									await fetch(
										uri
									);

								idx++;

								if (
									!res.ok
								) {
									throw new Error(
										`Failed to fetch ${uri}: HTTP ${res.status}`
									);
								}

								if (
									!res.body
								) {
									throw new Error(
										`Streaming response body unavailable for ${uri}`
									);
								}

								return res.body.getReader();
							};

						let current =
							await fetchNext();

						if (
							!current
						) {
							throw new Error(
								"Failed to fetch first WASM chunk"
							);
						}

						return new Response(
							new ReadableStream(
								{
									async pull(
										controller
									) {
										const {
											value,
											done
										} =
											await current.read();

										if (
											done ||
											!value
										) {
											runtimeChunkLoaded++;

											setRuntimeProgress(
												runtimeChunkLoaded /
													runtimeChunkCount,
												`.NET runtime — ${runtimeChunkLoaded}/${runtimeChunkCount} chunks`
											);

											current =
												await fetchNext();

											if (
												current
											) {
												await this.pull(
													controller
												);
											} else {
												controller.close();
											}
										} else {
											controller.enqueue(
												value
											);
										}
									},
								}
							),
							{
								headers: {
									"Content-Type":
										"application/wasm",
								},
							}
						);
					})();
				}
			)
			.create();
	})();

// ============================================================
// Download content + boot runtime in parallel
// ============================================================

const contentP =
	getTar(
		"Content.tar",
		"game content",
		"Content.tar"
	);

const audioP =
	wantMusic
		? getTar(
				"ContentAudio.tar",
				"music",
				"ContentAudio.tar"
			)
		: Promise.resolve(
				null
			);

const [
	contentTar,
	audioTar,
	runtime
] = await Promise.all([
	contentP,
	audioP,
	runtimeP
]);

setTitle(
	"Starting game..."
);

setRuntimeProgress(
	1,
	".NET runtime ready"
);

// ============================================================
// Get exports
// ============================================================

const exports =
	await runtime.getAssemblyExports(
		runtime.getConfig()
			.mainAssemblyName
	);

// ============================================================
// Tar parser
// ============================================================

function parseTar(tar) {
	if (
		!(tar instanceof Uint8Array)
	) {
		throw new TypeError(
			"Tar archive isn't a Uint8Array"
		);
	}

	const entries = [];
	const paths = new Set();

	const decoder =
		new TextDecoder(
			"utf-8",
			{
				fatal: true
			}
		);

	const readString =
		(
			buf,
			offset,
			length
		) => {
			let end =
				offset;

			while (
				end <
					offset +
						length &&
				buf[end] !== 0
			) {
				end++;
			}

			return decoder.decode(
				buf.subarray(
					offset,
					end
				)
			);
		};

	const readOctal =
		(
			buf,
			offset,
			length,
			field
		) => {
			const value =
				readString(
					buf,
					offset,
					length
				).trim();

			if (
				!/^[0-7]+$/.test(
					value
				)
			) {
				throw new Error(
					`Invalid tar ${field}: ${JSON.stringify(value)}`
				);
			}

			const parsed =
				Number.parseInt(
					value,
					8
				);

			if (
				!Number.isSafeInteger(
					parsed
				) ||
				parsed < 0
			) {
				throw new Error(
					`Tar ${field} is out of range`
				);
			}

			return parsed;
		};

	let pos = 0;
	let foundEnd = false;

	while (
		pos + 512 <=
		tar.length
	) {
		const header =
			tar.subarray(
				pos,
				pos + 512
			);

		if (
			header.every(
				(value) =>
					value === 0
			)
		) {
			foundEnd = true;
			break;
		}

		const storedChecksum =
			readOctal(
				header,
				148,
				8,
				"checksum"
			);

		let actualChecksum =
			0;

		for (
			let index = 0;
			index < 512;
			index++
		) {
			actualChecksum +=
				index >= 148 &&
				index < 156
					? 32
					: header[index];
		}

		if (
			storedChecksum !==
			actualChecksum
		) {
			throw new Error(
				`Tar checksum mismatch at byte ${pos}`
			);
		}

		const name =
			readString(
				header,
				0,
				100
			);

		const headerPrefix =
			readString(
				header,
				345,
				155
			);

		const fullName =
			headerPrefix
				? `${headerPrefix}/${name}`
				: name;

		const size =
			readOctal(
				header,
				124,
				12,
				"size"
			);

		const type =
			header[156];

		const isFile =
			type === 0 ||
			type === 48;

		const isDirectory =
			type === 53;

		if (
			!isFile &&
			!isDirectory
		) {
			throw new Error(
				`Unsupported tar entry type ${type} for ${fullName}`
			);
		}

		if (
			isDirectory &&
			size !== 0
		) {
			throw new Error(
				`Tar directory has data: ${fullName}`
			);
		}

		if (
			isFile &&
			fullName.endsWith("/")
		) {
			throw new Error(
				`Tar file has a directory path: ${fullName}`
			);
		}

		const path =
			fullName.endsWith("/")
				? fullName.slice(
						0,
						-1
					)
				: fullName;

		const segments =
			path.split("/");

		if (
			!path ||
			path.startsWith("/") ||
			path.includes("\\") ||
			segments.some(
				(segment) =>
					!segment ||
					segment === "." ||
					segment === ".."
			)
		) {
			throw new Error(
				`Unsafe tar path: ${JSON.stringify(fullName)}`
			);
		}

		if (
			paths.has(path)
		) {
			throw new Error(
				`Duplicate tar path: ${JSON.stringify(path)}`
			);
		}

		paths.add(path);

		const dataStart =
			pos + 512;

		const dataEnd =
			dataStart + size;

		const next =
			dataStart +
			Math.ceil(
				size / 512
			) *
				512;

		if (
			!Number.isSafeInteger(
				next
			) ||
			dataEnd >
				tar.length ||
			next > tar.length
		) {
			throw new Error(
				`Truncated tar entry: ${fullName}`
			);
		}

		entries.push({
			fullName: path,
			isDirectory,
			dataStart,
			dataEnd
		});

		pos = next;
	}

	if (!foundEnd) {
		throw new Error(
			"Tar archive has no complete end marker"
		);
	}

	for (
		let index = pos;
		index < tar.length;
		index++
	) {
		if (
			tar[index] !== 0
		) {
			throw new Error(
				"Tar archive contains data after its end marker"
			);
		}
	}

	return entries;
}

// ============================================================
// Tar extraction
// ============================================================

function extractTar(
	tar,
	prefix
) {
	const entries =
		parseTar(tar);

	let count = 0;

	for (
		const entry of entries
	) {
		const target =
			entry.fullName.startsWith(
				"__prefs__/"
			)
				? "/libsdl/saves/" +
					entry.fullName.slice(
						"__prefs__/".length
					)
				: prefix +
					entry.fullName;

		if (
			entry.isDirectory
		) {
			exports.WasmBootstrap.CreateContentDirectory(
				target
			);
		} else {
			exports.WasmBootstrap.WriteContentFile(
				target,
				tar.subarray(
					entry.dataStart,
					entry.dataEnd
				)
			);

			count++;
		}
	}

	return count;
}

// ============================================================
// Start runtime
// ============================================================

setTitle(
	"Starting game..."
);

await runtime.runMain();

await exports.WasmBootstrap.PreInit();

// ============================================================
// Restore saves
// ============================================================

setTitle(
	"Restoring saved data..."
);

try {
	const savesTar =
		await opfsRead(
			"Saves.tar"
		);

	exports.WasmBootstrap.CreateContentDirectory(
		"/libsdl/saves/Saves"
	);

	extractTar(
		savesTar,
		"/libsdl/saves/Saves/"
	);
} catch (error) {
	if (
		error?.name !==
		"NotFoundError"
	) {
		console.error(
			"Couldn't restore Saves.tar; archive was ignored:",
			error
		);
	}
}

// ============================================================
// Restore preferences
// ============================================================

try {
	const preferencesTar =
		await opfsRead(
			"DevicePreferences.tar"
		);

	extractTar(
		preferencesTar,
		"/libsdl/saves/"
	);
} catch (error) {
	if (
		error?.name !==
		"NotFoundError"
	) {
		console.error(
			"Couldn't restore DevicePreferences.tar; archive was ignored:",
			error
		);
	}
}

// ============================================================
// Extract game files
// ============================================================

setTitle(
	"Loading game files..."
);

setContentProgress(
	1,
	"Extracting game files..."
);

extractTar(
	contentTar,
	"/libsdl/"
);

if (audioTar) {
	setTitle(
		"Loading music..."
	);

	setContentProgress(
		1,
		"Extracting music..."
	);

	extractTar(
		audioTar,
		"/libsdl/"
	);
}

// ============================================================
// Initialize game
// ============================================================

setTitle(
	"Starting Stardew Valley..."
);

loading.classList.add(
	"hidden"
);

const dpr =
	window.devicePixelRatio ||
	1;

const w =
	Math.round(
		canvas.clientWidth *
			dpr
	) || 1280;

const h =
	Math.round(
		canvas.clientHeight *
			dpr
	) || 720;

await exports.WasmBootstrap.Init(
	w,
	h
);

// ============================================================
// Resize
// ============================================================

new ResizeObserver(
	() => {
		const dpr =
			window.devicePixelRatio ||
			1;

		const nw =
			Math.round(
				canvas.clientWidth *
					dpr
			);

		const nh =
			Math.round(
				canvas.clientHeight *
					dpr
			);

		if (
			nw > 0 &&
			nh > 0
		) {
			try {
				exports.WasmBootstrap.Resize(
					nw,
					nh
				);
			} catch {}
		}
	}
).observe(canvas);

// ============================================================
// Keyboard
// ============================================================

try {
	void navigator.keyboard
		?.lock()
		.catch(() => {});
} catch {}

document.addEventListener(
	"keydown",
	(e) => {
		if (
			[
				"Space",
				"ArrowUp",
				"ArrowDown",
				"ArrowLeft",
				"ArrowRight",
				"Tab"
			].includes(e.code)
		) {
			e.preventDefault();
		}
	}
);

// ============================================================
// Main loop
// ============================================================

try {
	await exports.WasmBootstrap.MainLoop();
} catch (error) {
	if (
		error !== "unwind" &&
		error?.message !== "unwind"
	) {
		throw error;
	}
}
