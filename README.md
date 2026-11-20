# Snowstorm

> **This fork** ([stirante.com/snowstorm](https://stirante.com/snowstorm/)) previews effects the way the game runs
> them: [particle-sim](https://github.com/stirante/particle-sim) (the game's particle rules on molang-go, as WASM)
> simulates the effect and bedrock-renderer (the game's Fancy and Vibrant Visuals pipelines, WebGPU) draws the
> particles over the usual grid. The footer switch picks Game: Fancy, Game: Vibrant Visuals or the original Wintersky;
> the slider next to it sets the time of day. Code: `src/game_preview.js`, `src/components/Preview.vue`;
> `vendor/` holds the two WASM modules (`tools/build-vendor.sh`); `tools/deploy.sh` publishes the site.
> Without WebGPU the preview stays on Wintersky.

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
