// The entry of the bundle (render.mjs bundles it): registers the root of the composition.
import { registerRoot } from 'remotion'
import { Root } from './Root.jsx'

registerRoot(Root)
