#!/usr/bin/env node
/* TODO:
 *   - Choose portion, re-encode with -c:v libx264, then use abbreviated clip
 *   - Functionalize this flat flow (especially storeInputMetadata which is async)
 *   - Split sting into 'strum' (loopable) and 'payoff' (always final)
 *   - Lots more!
 */

var _ = require('lodash');
var ffmpeg_cmd = require('fluent-ffmpeg');

var TEST_INPUT = './luluco1.flv'; // h264/aac; 7:50.09; 3216kb/s; 1080p
var ARROW_PATH = './assets/to-be-continued.png';
var AUDIO_PATH = './assets/roundabout-sting.mp3';

var out_w = 1280, out_h = 720, fps = '24000/1001', out_dur = 18.5;
var in_level = 0.0;

// Awkward way to store width, height and fps of input
var inW, inH, inFps;
function storeInputMetadata(err, data) {
  if (err) { console.log(err); return err; };
  var inVideo = _.filter(data.streams, {codec_type: "video"})[0];
  inW = inVideo.width;
  inH = inVideo.height;
  inFps = inVideo.r_frame_rate;
  return {width: inW, height: inH, fps: inFps};
}
ffmpeg_cmd.ffprobe(TEST_INPUT, storeInputMetadata);
console.log("got:",inW, inH, inFps);

/* IN CHAIN:
 * 0:v is input video (=> [video_in])
 * 0:a is input audio (=> [audio_in])
 * 1:v is TO BE CONTINUED arrow PNG (=> [arrow])
 * 2:a is Roundabout audio (=> [sting])
 * [bg] is a black color background
 */

// Get convenient names for known streams:
var renameVideoIn = {
    inputs: '0:v', filter: 'null', outputs: 'video_in'
}

var renameAudioIn = {
    inputs: '0:a', filter: 'anull', outputs: 'audio_in'
}

var renameArrow = {
    inputs: '1:v', filter: 'null', outputs: 'arrow'
}

var renameSting = {
    inputs: '2:a', filter: 'anull', outputs: 'sting'
}

// For use in complex_filter to force extension past freeze frame
var bgColor = {
    filter: 'color',
    options: {c: 'black', s: `${out_w}x${out_h}`, r: `${inFps}`},
    outputs: 'bg'
  };

var resize_input = {
    inputs: 'video_in',
    filter: 'scale',
    options: {w: -1, h:`min(ih,${out_h})`},
    outputs: 'vid_scaled'
  };

var split_vid = {
    inputs: '[vid_scaled]',
    filter: 'split',
    outputs: ['vidorig', 'vidmod']
  };

var sepia_tone = {
    inputs: 'vidmod',
    filter: 'colorchannelmixer',
    options: [.393, .769, .189, 0, .349, .686, .168, 0, .272, .534, .131],
    outputs: 'sepia'
  };

var mod_over_orig  = {
    inputs: ['vidorig', 'sepia'],
    filter: 'overlay',
    options: {x: 0, y:0, enable: `between(t,15,19)`},
    outputs: 'video_proc'
  };

var scaled_arrow = {
    inputs: 'arrow',
    filter: 'scale',
    options: ['ih/720', -1],
    outputs: 'arrow_scale'
  };

var arrow_overlay = {
    inputs: ['video_proc', 'arrow_scale'],
    filter: 'overlay',
    options: {x: '20*(main_w/1280)', y: '(main_h-(120*(main_h/720)))', enable: `between(t,15,19)`},
    outputs: 'composite'
}

var force_fade = {
    inputs: 'composite',
    filter: 'fade',
    options: {t: 'out', st: out_dur - 0.25, d: 0.25},
    outputs: 'withfade'
}

var over_black = {
  inputs: ['bg', 'withfade'],
  filter: 'overlay',
  options: {x: 0, y: 0},
  outputs: 'video_out'
}

var input_level = {
  inputs: 'audio_in',
  filter: 'volume',
  options: {volume: in_level},
  outputs: 'audio_leveled'
}

var mix_audio = {
  inputs: ['sting', 'audio_leveled'],
  filter: 'amix',
  options: {duration: 'first'},
  outputs: 'audio_out'
}

var command = new ffmpeg_cmd();

command.input(TEST_INPUT)
  .inputOption('-sseof -373.9')
  .inputOption(`-t ${out_dur - 3.5}`);
// store in

// Adding the arrow PNG:
command.input(ARROW_PATH);
// Adding the roundabout_sting offset as needed:
command.input(AUDIO_PATH)
  .seekInput(18.5 - out_dur);

// Stringing together our various filter chain pieces:
command.complexFilter([
  renameVideoIn, renameAudioIn, renameArrow, renameSting,
  {
    filter: 'color',
    options: {c: 'black', s: `${out_w}x${out_h}`, r: `24000/1001`},
    outputs: 'bg'
  },
  resize_input,
  split_vid, sepia_tone, mod_over_orig,
  scaled_arrow, arrow_overlay,
  force_fade, over_black,
  input_level, mix_audio
], ['video_out', 'audio_out']);

// Defining output path and options:
command.output('test-out.mp4')
  .outputOption(['-pix_fmt', 'yuv420p'])
  .outputOption('-y')
  .audioCodec('aac')
  .videoCodec('libx264')
  .duration(out_dur);

// Send console output when done
command.on('end', function() {
  console.log('Finished processing');
});

// For printing details from FfmpegCommand:
function reportInput(i) {
  return `${i.options.get().join(' ')} -i ${i.source}`;
}

function reportOutput(o) {
  return `${o.options.get().join(' ')} ${o.target}`;
}

var debugString = `ffmpeg ${command._inputs.map(reportInput).join(' ')} ${command._complexFilters.get().join(' ')} ${command._outputs.map(reportOutput).join(' ')}`

console.log(debugString);
console.log();
console.log(debugString.split(';').join(';\n'));

// #DoIt
command.run()
