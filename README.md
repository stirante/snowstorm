# Snowstorm

> **This fork** ([stirante.com/snowstorm](https://stirante.com/snowstorm/)) previews effects the way the game runs
> them: [particle-sim](https://github.com/stirante/particle-sim) (the game's particle rules on molang-go, as WASM)
> simulates the effect and bedrock-renderer (the game's Fancy and Vibrant Visuals pipelines, WebGPU) draws the whole
> view; three.js only keeps the orbit camera. The footer picks Fancy or Vibrant Visuals, the environment (a grid, a
> grass floor or a scanned vanilla area with block collision), the render resolution (Fast = CSS pixels, Sharp = screen pixels)
> and the time of day. MER opens the effect's Vibrant Visuals texture set (uniform MERS values or a MER / MERS image),
> which can be downloaded as the pack's `.texture_set.json`. The View menu's grid, axes,
> reference block and player are drawn by the renderer. The simulator's warnings (the game's particle caps, local
> space quirks, effects it cannot read) are listed in the warnings dialog.
> Code: `src/game_preview.js`, `src/components/Preview.vue`; `vendor/` holds the two WASM modules
> (`tools/build-vendor.sh`); `scans/` the vanilla areas (`tools/make_scans.py`, from bedrock-renderer's biome
> scans); `tools/deploy.sh` publishes the site. Vanilla textures come from Mojang's bedrock-samples on GitHub.
> Without WebGPU the preview falls back to Wintersky.

Custom editor for Minecraft Bedrock Edition particle files. Available as a web app and VSCode Extension:
* **Web App:** [snowstorm.app](https://snowstorm.app/)
* **VSCode Extension:** [Snowstorm - Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=JannisX11.snowstorm)


## Interface

![Snowstorm interface screenshot](https://snowstorm.app/content/interface.png)


## Development

1. Install node and run `npm install` to install all dependencies

2. Run `npm run watch` to run the bundler and update whenever you change anything

3. Open the app

	#### Web app:

	Use your preferred local server to host the app (npx serve, xampp, etc.), and open it in your browser

	#### VS Code Extension:

	Press F5 to run the Extension Development Host in a new VS Code instance
