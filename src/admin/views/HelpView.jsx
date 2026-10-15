import { HELP_TOPICS } from '../help.js'

/**
 * A short guide to working with the system: a screen of its own ("איך עובדים עם המערכת"), with a heading, and each topic in a card of its own
 * (one column on a phone, two equal columns from 1024px, in the reading order of the topics: see .a-help in admin.css).
 * Plain text, with no actions in it, so there is nothing to put in the order of a tile's actions. The text is in help.js.
 * The topics are <h2>, under the <h1> of the screen, and are flat: no topic has a heading of its own below it.
 */
export default function HelpView() {
  return (
    <>
      <div className="a-head">
        <div>
          <h1>איך עובדים עם המערכת</h1>
        </div>
      </div>
      <div className="a-help">
        {HELP_TOPICS.map((topic) => (
          <div key={topic.title} className="a-card a-help__topic">
            <h2 className="a-card__title">{topic.title}</h2>
            <p>{topic.text}</p>
          </div>
        ))}
      </div>
    </>
  )
}
