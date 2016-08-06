#!/usr/bin/env node
/* TODO:
 *   - Choose portion, re-encode with -c:v libx264, then use abbreviated clip
 *   - Get rid of ~globals
 *   - Split sting into 'strum' (loopable) and 'payoff' (always final)
 *   - Support vertical video...better?
 *   - Lots more!
 */

/* TODO WEIRDNESS:
 *   - Getting "N/A" for invideo.duration (see: logh02.mkv, luluco1.flv)
 */

var _ = require('lodash');
var Promise = require('bluebird');
var ffmpeg_cmd = require('fluent-ffmpeg');

var probe = Promise.promisify(ffmpeg_cmd.ffprobe);
var command = new ffmpeg_cmd();


var ARROW_PATH = './assets/to-be-continued.png';
var AUDIO_PATH = './assets/roundabout-sting.mp3';
var TEST_INPUT = {
  path: './luluco1.flv',
  width: null,
  height: null,
  duration: null,
  fps: null}; // h264/aac; 7:50.09; 3216kb/s; 1080p
var OUTPUT_PATH = './test-out.mp4'

var out_w = 1280, out_h = 720;
var out_dur = 8.5;

var seekCommand, seekAmount = 0;
var in_level = 1.0; // audio level from input

// Fetching width, height and FPS of input:
function storeMetadata(source) {
  return probe(source.path).then(
    function(result) {
      var inVideo = _.filter(result.streams, {codec_type: "video"})[0];
      console.log(inVideo);
      source.width = inVideo.width;
      source.height = inVideo.height;
      source.duration = inVideo.duration; //why am I getting "N/A" here on logh02.mkv?
      source.fps = inVideo.r_frame_rate;
      // check if we need a shorter out_dur?
      if (source.duration <= out_dur - 2) {
        out_dur = source.duration + 2
      }
      // check if poratrait orientation:
      if (source.width < source.height) {
        var holder = out_w;
        out_w = out_h;
        out_h = holder;
      }
      console.log("got:",source.width, source.height, source.duration, "@", source.fps);
      return source;
    }
  );
}

storeMetadata(TEST_INPUT).
  tap(console.log).
  then(setFreezes).
  then(renameStreams).
  then(staticFilters).
  then(dynamicFilters).
  then(composeCommand).
  then(executeCommand).
  catch(console.error);

/* IN CHAIN:
 * 0:v is input video (=> [video_in])
 * 0:a is input audio (=> [audio_in])
 * 1:v is TO BE CONTINUED arrow PNG (=> [arrow])
 * 2:a is Roundabout audio (=> [sting])
 * [bg] is a black color background
 */

var freezeStart, freezeEnd;
function setFreezes() {
  freezeStart = out_dur - 3.5;
  freezeEnd = out_dur + 2;
  return {freezeStart: freezeStart, freezeEnd: freezeEnd}
}

var renameVideoIn, renameAudioIn, renameArrow, renameSting;

// Get convenient names for known streams (static):
function renameStreams() {
  renameVideoIn = {
      inputs: '0:v', filter: 'null', outputs: 'video_in'
  }

  renameAudioIn = {
      inputs: '0:a', filter: 'anull', outputs: 'audio_in'
  }

  renameArrow = {
      inputs: '1:v', filter: 'null', outputs: 'arrow'
  }

  // Will need to change when strum/pay-off are split
  renameSting = {
      inputs: '2:a', filter: 'anull', outputs: 'sting'
  }

  return {renameVideoIn: renameVideoIn, renameAudioIn: renameAudioIn, renameArrow: renameArrow, renameSting: renameSting};
}

var split_vid, sepia_tone, over_black, mix_audio;
function staticFilters() {
  split_vid = {
      inputs: '[vid_scaled]',
      filter: 'split',
      outputs: ['vidorig', 'vidmod']
    };

  sepia_tone = {
      inputs: 'vidmod',
      filter: 'colorchannelmixer',
      options: [.393, .769, .189, 0, .349, .686, .168, 0, .272, .534, .131],
      outputs: 'sepia'
    };

  over_black = {
    inputs: ['bg', 'withfade'],
    filter: 'overlay',
    options: {x: 0, y: 0},
    outputs: 'video_out'
  }

  mix_audio = {
    inputs: ['sting', 'audio_leveled'],
    filter: 'amix',
    options: {duration: 'first'},
    outputs: 'audio_out'
  };

  return {split_vid: split_vid, sepia_tone: sepia_tone, over_black: over_black, mix_audio: mix_audio};
}

// Following are dynamic strings
var bgColor, force_fade, resize_input, mod_over_orig, arrow_overlay, input_level;
var scaled_arrow;
function dynamicFilters() {
  bgColor = {
    filter: 'color',
    options: {c: 'black', s: `${out_w}x${out_h}`, r: `${TEST_INPUT.fps}`},
    outputs: 'bg'
  };

  force_fade = {
    inputs: 'composite',
    filter: 'fade',
    options: {t: 'out', st: out_dur - 0.25, d: 0.25},
    outputs: 'withfade'
  }

  resize_input = {
    inputs: 'video_in',
    filter: 'scale',
    options: {w: -1, h:`min(ih,${out_h})`},
    outputs: 'vid_scaled'
  };

  mod_over_orig  = {
    inputs: ['vidorig', 'sepia'],
    filter: 'overlay',
    options: {x: 0, y:0, enable: `between(t,${freezeStart},${freezeEnd})`},
    outputs: 'video_proc'
  };

  // Reconsider logic for position arrow (to account for vertical orientation/aspect ratio)
  arrow_overlay = {
    inputs: ['video_proc', 'arrow_scale'],
    filter: 'overlay',
    options: {x: '20*(main_w/1280)', y: '(main_h-(120*(main_h/720)))', enable: `between(t,${freezeStart},${freezeEnd})`},
    outputs: 'composite'
  }

  input_level = {
    inputs: 'audio_in',
    filter: 'volume',
    options: {volume: in_level},
    outputs: 'audio_leveled'
  }

  // Need to fix this, It will definitely depend on metadata, though....
  scaled_arrow = {
    inputs: 'arrow',
    filter: 'scale',
    options: ['ih/720', -1],
    outputs: 'arrow_scale'
  };

  return {bgColor: bgColor, force_fade: force_fade, resize_input: resize_input, mod_over_orig: mod_over_orig, arrow_overlay: arrow_overlay, input_level: input_level, scaled_arrow: scaled_arrow};
}

function composeCommand() {
  // seekCommand is 'ss' or 'sseof'
  if (seekAmount < 0) {
    seekCommand = 'sseof'
  } else {
    seekCommand = 'ss'
  }

  command.input(TEST_INPUT.path)
    .inputOption(`-${seekCommand} ${seekAmount}`)
    .inputOption(`-t ${freezeStart + 0.15}`);

  // Adding the arrow PNG:
  command.input(ARROW_PATH);
  // Adding the roundabout_sting offset as needed:
  // TODO: This is where we should use the separate strum/payoff files
  command.input(AUDIO_PATH)
    .seekInput(18.5 - out_dur);

  // Stringing together our various filter chain pieces:
  command.complexFilter([
    renameVideoIn, renameAudioIn, renameArrow, renameSting,
    {
      filter: 'color',
      options: {c: 'black', s: `${out_w}x${out_h}`, r: `${TEST_INPUT.fps}`},
      outputs: 'bg'
    },
    resize_input,
    split_vid, sepia_tone, mod_over_orig,
    scaled_arrow, arrow_overlay,
    force_fade, over_black,
    input_level, mix_audio
  ], ['video_out', 'audio_out']);

  // Defining output path and options:
  command.output(`${OUTPUT_PATH}`)
    .outputOption(['-pix_fmt', 'yuv420p'])
    .outputOption('-y')
    .audioCodec('aac')
    .videoCodec('libx264')
    .duration(out_dur);
}

function executeCommand() {
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
  command.run();
}
