import { HELP_TOPICS } from '../help.js'

/** The topics in the two columns of a computer: the first half in the first column (the right one in this right-to-left page), the rest in the second. */
const COLUMNS = [HELP_TOPICS.slice(0, Math.ceil(HELP_TOPICS.length / 2)), HELP_TOPICS.slice(Math.ceil(HELP_TOPICS.length / 2))]

/**
 * A short guide to working with the system: a screen of its own ("איך עובדים עם המערכת"), with a heading, and each topic in a card of its own.
 * The cards are in two stacks, the first half of the topics and the rest: one column on a phone (the stacks add nothing there), and from 1024px two
 * equal columns that each flow on their own (see .a-help in admin.css). The order of the page is the order of help.js, the first stack first.
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
      <div className="a-stack a-help">
        {COLUMNS.map((topics) => (
          <div key={topics[0].title} className="a-stack a-help__col">
            {topics.map((topic) => (
              <div key={topic.title} className="a-card a-help__topic">
                <h2 className="a-card__title">{topic.title}</h2>
                <p>{topic.text}</p>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  )
}
