import { config } from './lib/config'

// 両方を静的に import しないのは、読み込んだ時点でそれぞれの DB を開くため、使わないほうのモードの DB まで作られるため
const { default: app } = config.moodle ? await import('./moodle-mode/app') : await import('./app')

export default app
