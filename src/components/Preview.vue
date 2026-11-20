<template>
    <main id="preview" class="preview">
        <div id="canvas_wrapper">
            <div id="overlay_timestamp">{{ timestamp }}</div>
            <canvas id="canvas" @click="blur()" ref="canvas"></canvas>
            <div id="game_status" v-if="game.status">{{ game.status }}</div>
            <div class="placeholder_bar" v-if="show_placeholder_bar">
                <ul>
                    <li v-for="(key) in placeholder_keys" :key="key">
                        <label :for="'placeholder_'+key">{{ key.replace(key.substring(1, key.indexOf('.')), '') }}</label>
                        <input type="number" :id="'placeholder_'+key" :value="placeholder_values[key] || 0" @input="updatePlaceholderValue(key, $event)">
                        <div class="tool" v-if="key.startsWith('variable')" @click="bakePlaceholderVariable(key)" title="Bake variable value into all expressions">
                            <CheckCheck :size="20" />
                        </div>
                    </li>
                    <li v-if="placeholder_keys.length == 0"><label>No undefined variables found</label></li>
                </ul>

                <div class="tool" @click="hidePlaceholderBar()" title="Hide Variable Placeholder Bar">
                    <X :size="22" />
                </div>
            </div>
        </div>
        <footer>
            <select id="loop_mode" v-model="loop_mode" @change="changeLoopMode()">
                <option value="auto">Auto</option>
                <option value="looping">Looping</option>
                <option value="once">Once</option>
            </select>
            <select id="parent_mode" v-model="parent_mode" @change="changeParentMode()">
                <option value="world">World</option>
                <option value="entity">Entity</option>
                <option value="locator">Locator</option>
            </select>
            <select id="engine" v-model="engine" @change="changeEngine()" title="Graphics mode">
                <option value="fancy">Fancy</option>
                <option value="vibrant">Vibrant Visuals</option>
            </select>
            <select id="environment" v-model="environment" @change="changeEnvironment()" title="Environment">
                <option v-for="env in environments" :key="env.id" :value="env.id">{{ env.label }}</option>
            </select>
            <input class="time_slider" type="range" min="0" max="1" step="0.005" :value="(game.time + 0.5) % 1" @input="changeTime($event)" :title="'Time of day ' + clock">
            <div class="tool ground_collision" :class="{toggle_enabled: collision}" @click="toggleCollision()" title="Preview Collisions">
                <FlipVertical2 :size="20" v-if="collision" />
                <Minus :size="20" v-else />
            </div>
            <div class="tool" :class="{toggle_enabled: show_placeholder_bar}" @click="show_placeholder_bar ? hidePlaceholderBar() : showPlaceholderBar()" title="Show Variable Placeholder Bar">
                <Hash :size="22" />
            </div>

            <div class="spacing" />

            <div class="tool" @click="startAnimation()" title="Play">
                <Play :size="22" />
            </div>
            <div class="tool" @click="togglePause()" title="Pause">
                <Pause :size="22" />
            </div>

            <div class="spacing" />

            <div class="tool warning" @click="$emit('opendialog', 'warnings')" v-if="warning_count" :title="getWarningTitle()"><i class="unicode_icon warn">⚠</i>{{ warning_count }}</div>
            <div class="stat">{{particle_counter}} P</div>
            <div class="stat" style="width: 66px;">{{fps}} FPS</div>
        </footer>

        <dialog id="bake_placeholder_confirm_dialog" ref="bake_placeholder_confirm_dialog" class="modal_dialog" style="max-width: 308px;">
            <div class="form_bar">Do you want to replace all occurrences of '{{ bake_placeholder_key }}' with the value '{{ placeholder_values[bake_placeholder_key] }}'?</div>
            <div class="button_bar">
                <button @click="bakePlaceholderVariableConfirm()">Confirm</button>
                <button @click="$refs.bake_placeholder_confirm_dialog.close()">Cancel</button>
            </div>
        </dialog>
    </main>
</template>

<script>

    import {Emitter} from './../emitter';
    import {validate} from './WarningDialog'
    import {OptionValues} from './../options'
    import {
        FlipVertical2,
        Minus,
        Play,
        Pause,
        Hash,
        X,
        CheckCheck
    } from 'lucide-vue'
    import {EditListeners} from '../edits'
    import {updateVariablePlaceholderList, bakePlaceholderVariable} from './../variable_placeholders'
    import { Game, ENVIRONMENTS, initGame, setEngine, setEnvironment, setTime, frame, restart, screenshotURL } from '../game_preview';
    import { attach } from '../orbit';

    const View = {
        updateVariablePlaceholderList() {},
        grid: {visible: OptionValues.grid_visible},
        minecraft_block: {visible: OptionValues.minecraft_block_visible},
        minecraft_player: {visible: OptionValues.minecraft_player_visible},
        helper: {visible: OptionValues.axis_helper_visible},
        PlaybackController: {
            start() {
                Emitter.paused = false;
                return View.PlaybackController;
            },
            toggle() {
                Emitter.paused = !Emitter.paused;
                return View.PlaybackController;
            },
            stop() {
                Emitter.paused = true;
                restart();
                return View.PlaybackController;
            }
        }
    }

    const stats = {
        time: 0
    };

    View.screenshot = function() {
        let dataurl = screenshotURL();
        if (!dataurl) return;
        let is_ff = navigator.userAgent.toLowerCase().indexOf('firefox') > -1
        let download = document.createElement('a');
        download.href = dataurl
        download.download = `snowstorm_screenshot.png`;
        if (is_ff) document.body.appendChild(download);
        download.click();
        if (is_ff) document.body.removeChild(download);
    }

    function startAnimation() {
        View.PlaybackController.stop().start();
    }
    function togglePause() {
        View.PlaybackController.toggle();
    }

    function initPreview(canvas) {
        View.canvas = canvas;
        attach(canvas);
        animate();
    }

    let last_time = performance.now();
    function animate() {
        requestAnimationFrame(animate);
        let timestamp = performance.now();
        Game.paused = Emitter.paused;
        if (View.canvas.offsetParent) {
            frame(Math.min(0.1, (timestamp - last_time) / 1000));
            View.frames_this_second++;
            stats.time = Game.elapsed;
        }
        last_time = timestamp;
    }

    window.addEventListener('keypress', (e) => {
        var input_focus = document.querySelector('input:focus, div[contenteditable="true"]:focus, textarea:focus')
        if (input_focus) return;

        if (e.which === 32 && e.ctrlKey) {
            togglePause()
        } else if (e.which === 32) {
            startAnimation()
        }
    })

    View.placeholder_variables = {};
	View.frames_this_second = 0;

    export default {
        name: 'preview',
        data() {return {
            fps: 0,
            particles: 0,
            loop_mode: 'auto',
            parent_mode: 'world',
            warning_count: 0,
            stats,
            collision: true,
            placeholder_keys: [],
            placeholder_values: {},
            show_placeholder_bar: localStorage.getItem('snowstorm_show_placeholder_bar') == 'true',
            bake_placeholder_key: null,
            engine: Game.engine,
            environment: Game.environment,
            environments: ENVIRONMENTS,
            game: Game
        }},
        components: {
            FlipVertical2,
            Minus,
            Play,
            Pause,
            Hash,
            X,
            CheckCheck,
        },
        methods: {
            updateSize() {},
            showPlaceholderBar() {
                this.show_placeholder_bar = true;
                updateVariablePlaceholderList(this.placeholder_keys);
                localStorage.setItem('snowstorm_show_placeholder_bar', 'true');
            },
            hidePlaceholderBar() {
                this.show_placeholder_bar = false;
                localStorage.setItem('snowstorm_show_placeholder_bar', 'false');
            },
            updatePlaceholderValue(key, event) {
                this.placeholder_values[key] = parseFloat(event.target.value) || 0;
                for (let key in View.placeholder_variables) {
                    delete View.placeholder_variables[key];
                }
                for (let key of this.placeholder_keys) {
                    if (!this.placeholder_values[key]) this.placeholder_values[key] = 0;
                    View.placeholder_variables[key] = this.placeholder_values[key];
                }
            },
            bakePlaceholderVariableConfirm() {
                this.$refs.bake_placeholder_confirm_dialog.close();
                let key = this.bake_placeholder_key;
                bakePlaceholderVariable(key, this.placeholder_values[key] || 0);
            },
            bakePlaceholderVariable(key) {
                this.bake_placeholder_key = key;
                this.$refs.bake_placeholder_confirm_dialog.showModal();
            },
            changeLoopMode() {
                Game.loop_mode = this.loop_mode;
            },
            async changeEngine() {
                await setEngine(this.engine);
                this.engine = Game.engine;
            },
            changeEnvironment() {
                setEnvironment(this.environment);
            },
            changeTime(event) {
                setTime(parseFloat(event.target.value) - 0.5);
            },
            changeParentMode() {
                Emitter.parent_mode = this.parent_mode;
            },
            toggleCollision() {
                this.collision = !this.collision;
                Game.collision = this.collision;
                restart();
            },
            getWarningTitle() {
                return this.warning_count == 1
                    ? '1 Warning'
                    : (this.warning_count + ' Warnings');
            },
            blur() {
                document.activeElement.blur()
            },
            startAnimation,
            togglePause
        },
        computed: {
            particle_counter() {
                let string = this.particles.toString();
                return string.replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1,')
            },
            timestamp() {
                let time = this.stats.time;
                let fractions = Math.floor((time % 1) * 10).toString();
                //if (fractions.length == 1) fractions = '0'+fractions;
                return `${Math.floor(time)}:${fractions}`;
            },
            clock() {
                let m = Math.round((((this.game.time * 24 + 12) % 24) + 24) % 24 * 60) % 1440;
                return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
            }
        },
        mounted() {
            initPreview(this.$refs.canvas);
            initGame(View).then(() => { this.engine = Game.engine; });
            setInterval(() => {
                this.fps = View.frames_this_second;
                View.frames_this_second = 0;
            }, 1000)
            setInterval(() => {
                this.particles = Game.particles;
            }, 200)
            setInterval(() => {
                if (window.document.hasFocus() && View.canvas.offsetParent) {
                    this.warning_count = validate().length;
                }
            }, 500)
            EditListeners['placeholder_bar'] = () => {
                if (this.show_placeholder_bar) {
                    updateVariablePlaceholderList(this.placeholder_keys);
                }
            };
            View.updateVariablePlaceholderList = () => {
                updateVariablePlaceholderList(this.placeholder_keys);
            }
        }
    }
    export {View}
</script>

<style scoped>
	main#preview {
		position: relative;
        --footer-height: 34px;
	}
	#canvas_wrapper {
		height: calc(100% - var(--footer-height));
		width: 100%;
		position: relative;
	}
    #canvas_wrapper {
        background-color: #29323a;
    }
    #game_status {
        position: absolute;
        top: 0;
        right: 0;
        padding: 4px 10px;
        opacity: 0.7;
        pointer-events: none;
    }
    input.time_slider {
        appearance: auto;
        -webkit-appearance: auto;
        width: 110px;
        height: auto;
        margin: 0 6px;
        padding: 0;
        background: transparent;
        border: none;
        accent-color: var(--color-accent, #3e90ff);
    }
	canvas {
		height: 100%;
		width: 100%;
        outline: none;
	}
    #overlay_timestamp {
        top: 0;
        left: 0;
        position: absolute;
        opacity: 0.5;
        padding: 4px 10px;
        font-size: 1.1em;
        font-family: Consolas, monospace;
        pointer-events: none;
    }
    .placeholder_bar {
        position: absolute;
        bottom: 34px;
        min-height: 35px;
        width: 100%;
        display: flex;
        background-color: color-mix(in srgb, var(--color-background) 90%, transparent);
        border-top: 1px solid var(--color-border);
        backdrop-filter: blur(4px);
    }
    .placeholder_bar > ul {
        display: flex;
        padding: 2px 10px;
        gap: 2px 12px;
        flex-grow: 1;
        flex-wrap: wrap;
    }
    .placeholder_bar > ul > li {
        display: flex;
        gap: 5px;
        align-items: center;
    }
    .placeholder_bar > .tool {
        padding-top: 4px;
    }
    .placeholder_bar input {
        width: 70px;
    }
    .placeholder_bar label {
        color: var(--color-text_grayed);
    }
    .placeholder_bar li > .tool {
        width: 24px;
	    padding: 2px;
    }
	footer {
		width: 100%;
		font-size: 1.1em;
        height: var(--footer-height);
        background-color: var(--color-bar);
        border-top: 1px solid var(--color-border);
        display: flex;
        overflow-x: auto;
		overflow-y: hidden;
		scrollbar-width: none;
	}	
    footer ::-webkit-scrollbar {
		height: 0px;
	}
	footer > * {
		padding: 4px 8px;
		padding-top: 4px;
        background-color: var(--color-bar);
    }
	footer > .tool {
		padding-top: 2px;
    }
    footer .spacing {
        flex: 1 1 auto;
        padding: 0;
        margin: 0;
    }
    select {
        appearance: none;
        background-color: var(--color-dark);
        border-top: none;
        height: 100%;
        margin-left: 4px;
        padding: 2px 6px;
    }
    #app.portrait_view footer select {
        border-bottom: none;
    }
	div.stat {
        text-align: right;
		float: right;
		background: transparent;
        min-width: 72px;
	}
    div.warning {
        color: #ffc107;
        float: right;
        width: auto;
    }
    div.warning:hover {
        color: #ffe060;
        float: right;
    }
    div.warning > i {
        display: inline;
        margin-right: 4px;
    }
	.unicode_icon.pause {
        margin-top: -4px;
        float: right;
        font-size: 20pt;
        font-weight: bold;
        height: 23px;
        overflow: hidden;
	}
    .tool.toggle_enabled {
        background-color: var(--color-background);
    }
    
</style>