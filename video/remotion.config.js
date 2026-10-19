// The settings of the Remotion command line, for looking at the composition while it is edited (`npx remotion studio` in this folder, with
// the pictures of the Hebrew video in video/out/he). The render of the repository is video/src/render.mjs, which sets its own options in
// code and does not read this file.
import { Config } from '@remotion/cli/config'

Config.setEntryPoint('./src/index.jsx')
Config.setPublicDir('./out/he')
Config.setVideoImageFormat('jpeg')
Config.setOverwriteOutput(true)
