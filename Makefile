.PHONY: test bytecode wasm tutorial

# This legacy fixture is embedded by a portable Rust unit test.
bytecode:
	mkdir -p build
	node tools/ghostc.mjs examples/irrigation.ghost build/irrigation.gfb

test:
	npm test

wasm:
	npm run build:wasm

tutorial:
	npm run tutorial
