const loading = document.getElementById("loading");
const canvas = document.getElementById("canvas");
const musicChoice = document.getElementById("music-choice");

// ============================================================
// Loading UI + visible debug log
// ============================================================

const loadingUI = document.createElement("div");

loadingUI.innerHTML = `
	<div id="load-title" style="
		font-size:1.5rem;
		margin-bottom:10px;
	">Starting...</div>

	<div id="content-load" style="
		width:min(520px,80vw);
	">
		<div id="content-label" style="
			font-size:.9rem;
			opacity:.8;
			margin-bottom:5px;
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

	<div id="runtime-load" style="
		width:min(520px,80vw);
		margin-top:14px;
	">
		<div id="runtime-label" style="
			font-size:.9rem;
			opacity:.8;
			margin-bottom:5px;
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

	<div id="debug-box" style="
		display:block;
		width:min(760px,90vw);
		margin-top:18px;
		padding:12px;
		box-sizing:border-box;
		background:rgba(0,0,0,.7);
		border:1px solid rgba(255,255,255,.2);
		border-radius:8px;
		text-align:left;
		font-family:monospace;
		font-size:12px;
		line-height:1.4;
		max-height:300px;
		overflow:auto;
		white-space:pre-wrap;
		word-break:break-word;
	">
	</div>
`;

loading.appendChild(loadingUI);

const loadTitle =
	document.getElementById("load-title");

const contentLabel =
	document.getElementById("content-label");

const contentBar =
	document.getElementById("content-bar");

const runtimeLabel =
	document.getElementById("runtime-label");

const runtimeBar =
	document.getElementById("runtime-bar");

const debugBox =
	document.getElementById("debug-box");

function debugLog(message) {
	const time =
		new Date().toLocaleTimeString();

	debugBox.textContent +=
		`[${time}] ${message}\n`;

	debugBox.scrollTop =
		debugBox.scrollHeight;
}

function debugError(error) {
	const message =
		error?.message ??
		String(error);

	const stack =
		error?.stack ??
		"No stack trace available.";

	debugLog(`ERROR: ${message}`);
	debugLog(`STACK:\n${stack}`);
}

function setTitle(text) {
	loadTitle.textContent = text;
	debugLog(`STAGE: ${text}`);
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

function showLoadError(error) {
	console.error(error);

	loadTitle.textContent =
		"Game failed to load";

	contentLabel.textContent =
		"Game content loaded";

	runtimeLabel.textContent =
		"Runtime error";

	debugError(error);
}

window.addEventListener(
	"error",
	(event) => {
		debugLog(
			`WINDOW ERROR: ${event.message || "Unknown error"}`
		);

		if (event.error) {
			showLoadError(event.error);
		} else {
			showLoadError(
				new Error(
					event.message ||
					"Unknown browser error"
				)
			);
		}
	}
);

window.addEventListener(
	"unhandledrejection",
	(event) => {
		debugLog(
			"UNHANDLED PROMISE REJECTION"
		);

		showLoadError(
			event.reason instanceof Error
				? event.reason
				: new Error(
					String(event.reason)
				)
		);
	}
);

debugLog("Booting Stardew web port...");

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
// Chunk count
// ============================================================

async function fetchChunkCount(url) {
	debugLog(`Reading chunk count: ${url}`);

	const response =
		await fetch(url);

	if (!response.ok) {
		throw new Error(
			`Failed to fetch ${url}: HTTP ${response.status}`
		);
	}

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
	writeChunk
) {
	setTitle(
		`Downloading ${label}...`
	);

	const count =
		await fetchChunkCount(
			base + ".count"
		);

	debugLog(
		`${label}: ${count} chunks`
	);

	let total = 0;

	for (
		let i = 0;
		i < count;
		i++
	) {
		const url =
			`${base}${String(i).padStart(2, "0")}`;

		debugLog(
			`Fetching ${label} chunk ${i + 1}/${count}...`
		);

		const res =
			await fetch(url);

		if (!res.ok) {
			throw new Error(
				`Failed to fetch ${res.url}: HTTP ${res.status}`
			);
		}

		if (!res.body) {
			throw new Error(
				`Streaming response body unavailable for ${res.url}`
			);
		}

		const reader =
			res.body.getReader();

		for (;;) {
			const {
				done,
				value
			} =
				await reader.read();

			if (done)
				break;

			await writeChunk(value);

			total +=
				value.length;
		}

		const fraction =
			(i + 1) / count;

		if (label === "game content") {
			setContentProgress(
				fraction,
				`${label} — chunk ${i + 1}/${count} — ${(total / 1048576) | 0} MB`
			);
		} else {
			setContentProgress(
				fraction,
				`${label} — chunk ${i + 1}/${count}`
			);
		}

		debugLog(
			`${label} chunk ${i + 1}/${count} loaded.`
		);
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

	debugLog(
		`Allocating ${initialSize / 1048576} MB buffer for ${label}.`
	);

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

				debugLog(
					`Growing ${label} buffer to ${newSize / 1048576} MB.`
				);

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
		}
	);

	debugLog(
		`${label} loaded: ${(offset / 1048576).toFixed(1)} MB`
	);

	return tar.subarray(
		0,
		offset
	);
}

// Initial content bypasses OPFS.
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
	await new Promise(
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

					debugLog(
						"User selected: without music"
					);

					resolve(false);
				};

			document
				.getElementById(
					"btn-with-music"
				)
				.onclick = () => {
					musicChoice.style.display =
						"none";

					debugLog(
						"User selected: with music"
					);

					resolve(true);
				};
		}
	);

musicChoice.style.display =
	"none";

// ============================================================
// Runtime loader
// ============================================================

const runtimeP =
	(async () => {
		setRuntimeProgress(
			0,
			"Loading .NET runtime..."
		);

		debugLog(
			"Importing ./_framework/dotnet.js..."
		);

		const {
			dotnet
		} =
			await import(
				"./_framework/dotnet.js"
			);

		debugLog(
			"dotnet.js imported successfully."
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
						type !== "dotnetwasm" ||
						behavior !== "dotnetwasm"
					) {
						return;
					}

					return (async () => {
						debugLog(
							`WASM resource requested: ${defaultUri}`
						);

						const count =
							await fetchChunkCount(
								defaultUri +
								".count"
							);

						debugLog(
							`WASM runtime has ${count} chunks.`
						);

						let idx = 0;

						const fetchNext =
							async () => {
								if (
									idx >=
									count
								) {
									return null;
								}

								const chunkNumber =
									idx;

								const uri =
									defaultUri +
									chunkNumber;

								debugLog(
									`Fetching WASM chunk ${chunkNumber + 1}/${count}...`
								);

								const res =
									await fetch(
										uri
									);

								if (!res.ok) {
									throw new Error(
										`Failed to fetch ${uri}: HTTP ${res.status}`
									);
								}

								if (!res.body) {
									throw new Error(
										`Streaming response body unavailable for ${uri}`
									);
								}

								idx++;

								debugLog(
									`WASM chunk ${chunkNumber + 1}/${count} downloaded.`
								);

								setRuntimeProgress(
									chunkNumber / count,
									`.NET runtime — ${chunkNumber + 1}/${count} chunks`
								);

								return res.body.getReader();
							};

						let current =
							await fetchNext();

						if (!current) {
							throw new Error(
								"Failed to fetch first WASM chunk"
							);
						}

						return new Response(
							new ReadableStream({
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
										current =
											await fetchNext();

										if (
											current
										) {
											await this.pull(
												controller
											);
										} else {
											setRuntimeProgress(
												1,
												".NET runtime downloaded"
											);

											debugLog(
												"All WASM runtime chunks streamed."
											);

											controller.close();
										}
									} else {
										controller.enqueue(
											value
										);
									}
								},
							}),
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
// Download game files + start runtime in parallel
// ============================================================

debugLog(
	"Starting content/runtime tasks in parallel..."
);

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
		: Promise.resolve(null);

const [
	contentTar,
	audioTar,
	runtime
] =
	await Promise.all([
		contentP,
		audioP,
		runtimeP
	]);

debugLog(
	"Content and runtime preparation finished."
);

setRuntimeProgress(
	1,
	".NET runtime ready"
);

setTitle(
	"Starting game runtime..."
);

debugLog(
	"Getting .NET assembly exports..."
);

// ============================================================
// Get exports
// ============================================================

const exports =
	await runtime.getAssemblyExports(
		runtime.getConfig()
			.mainAssemblyName
	);

debugLog(
	"Assembly exports loaded successfully."
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
			next >
				tar.length
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

	debugLog(
		`Extracting ${entries.length} tar entries...`
	);

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

	debugLog(
		`Extracted ${count} files.`
	);

	return count;
}

// ============================================================
// Start runtime
// ============================================================

setTitle(
	"Starting game runtime..."
);

debugLog(
	"Calling runtime.runMain()..."
);

await runtime.runMain();

debugLog(
	"runtime.runMain() completed."
);

debugLog(
	"Calling WasmBootstrap.PreInit()..."
);

await exports.WasmBootstrap.PreInit();

debugLog(
	"PreInit completed."
);

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

	debugLog(
		"Saves.tar found. Restoring..."
	);

	exports.WasmBootstrap.CreateContentDirectory(
		"/libsdl/saves/Saves"
	);

	extractTar(
		savesTar,
		"/libsdl/saves/Saves/"
	);

	debugLog(
		"Save data restored."
	);
} catch (error) {
	if (
		error?.name ===
		"NotFoundError"
	) {
		debugLog(
			"No previous save archive found."
		);
	} else {
		debugLog(
			"Save archive could not be restored; continuing."
		);

		console.error(
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

	debugLog(
		"DevicePreferences.tar found. Restoring..."
	);

	extractTar(
		preferencesTar,
		"/libsdl/saves/"
	);

	debugLog(
		"Preferences restored."
	);
} catch (error) {
	if (
		error?.name ===
		"NotFoundError"
	) {
		debugLog(
			"No previous preferences found."
		);
	} else {
		debugLog(
			"Preferences could not be restored; continuing."
		);

		console.error(
			error
		);
	}
}

// ============================================================
// Extract game content
// ============================================================

setTitle(
	"Loading game files..."
);

contentLabel.textContent =
	"Extracting game content...";

debugLog(
	"Extracting game content into WasmFS..."
);

extractTar(
	contentTar,
	"/libsdl/"
);

debugLog(
	"Game content extracted."
);

if (audioTar) {
	setTitle(
		"Loading music..."
	);

	contentLabel.textContent =
		"Extracting music...";

	debugLog(
		"Extracting music into WasmFS..."
	);

	extractTar(
		audioTar,
		"/libsdl/"
	);

	debugLog(
		"Music extracted."
	);
}

// ============================================================
// Initialize game
// ============================================================

setTitle(
	"Starting Stardew Valley..."
);

debugLog(
	"Initializing game..."
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

debugLog(
	`Canvas size: ${w}x${h}`
);

await exports.WasmBootstrap.Init(
	w,
	h
);

debugLog(
	"Game initialization completed."
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
			].includes(
				e.code
			)
		) {
			e.preventDefault();
		}
	}
);

// ============================================================
// Main loop
// ============================================================

debugLog(
	"Starting Stardew main loop..."
);

try {
	await exports.WasmBootstrap.MainLoop();
} catch (error) {
	if (
		error !== "unwind" &&
		error?.message !== "unwind"
	) {
		throw error;
	}

	debugLog(
		"MainLoop exited with normal 'unwind' sentinel."
	);
}
