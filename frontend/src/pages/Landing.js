import { Navigate, useNavigate } from "react-router-dom"; // Navigate = a component that redirects; useNavigate = a hook (a React helper function) that changes the page from code
import { TbPencilPlus, TbBooks, TbBook2, TbId, TbShare3, TbMessageCircle } from "react-icons/tb"; // icons: each one is a small React component that draws an SVG (a picture made of shapes)
import { Button } from "../components/ui"; // the shared Button, so the landing page buttons match the rest of the app
import { useAuth } from "../AuthContext"; // gives us { status } = "checking" | "in" | "out", so we can skip this page for logged-in people

// FEATURES = plain data (an array of objects). Keeping content as data means we write the card layout ONCE and loop over this list.
const FEATURES = [ // an array: an ordered list of items
    { icon: <TbPencilPlus />, title: "Add words your way", text: "Type a word, or say it out loud and it lands in your list." }, // feature 1: adding words by typing or voice
    { icon: <TbBooks />, title: "Read PDFs", text: "Keep PDFs in your library. Zoom, search, bookmark, tap any word." }, // feature 2: the PDF reader
    { icon: <TbBook2 />, title: "Meanings in context", text: "See what a word means in the sentence you found it in." }, // feature 3: contextual meanings
    { icon: <TbId />, title: "Word profile", text: "Notes, source page, progress, and quizzes for every word." }, // feature 4: the word profile page
    { icon: <TbShare3 />, title: "Share a word card", text: "Send a clean little card of a word you love." }, // feature 5: sharing a word card
    { icon: <TbMessageCircle />, title: "Speaking coach", text: "Talk at your level and get a teacher-style reflection." }, // feature 6: the speaking coach
]; // end of the FEATURES array

// STEPS = the three "How it works" lines, also kept as data.
const STEPS = [ // an array of strings
    "Add a PDF or a few words", // step 1
    "Understand them in context and save", // step 2
    "Quiz, share, and practice speaking", // step 3
]; // end of the STEPS array

// FeatureItem = one small reusable piece (a "component") that draws ONE feature.
// DATA FLOW (parent → child): Landing passes icon, title and text DOWN as props (props = the inputs a component receives).
function FeatureItem({ icon, title, text }) { // destructuring: pull the three props out of the props object in one go
    return ( // what this component draws
        <div className="lp-feature">{/* wrapper for one feature */}
            <div className="lp-icon" aria-hidden="true">{icon}</div>{/* yellow tile holding the icon; aria-hidden hides decoration from screen readers */}
            <h3 className="lp-feature-title">{title}</h3>{/* the feature name; {title} drops the prop's value into the page */}
            <p className="lp-feature-text">{text}</p>{/* the one-line description */}
        </div> // end of the <div> that wraps this component's markup
    ); // end of what FeatureItem draws
} // end of FeatureItem

// Step = one numbered circle with its sentence.
// DATA FLOW (parent → child): Landing passes number and text DOWN as props.
function Step({ number, text }) { // pull the two props out
    return ( // what this component draws
        <div className="lp-step">{/* one row: circle + sentence */}
            <div className="lp-step-num">{number}</div>{/* the yellow numbered circle */}
            <p>{text}</p>{/* the sentence next to it */}
        </div> // end of the <div> that wraps this component's markup
    ); // end of what Step draws
} // end of Step

// WordCard = the sample card in the hero. It has no props because its content is fixed sample text (a preview, not real data).
function WordCard() { // a component with no inputs
    return ( // what this component draws
        <div className="lp-card-wrap">{/* positions the real card and the tilted card behind it */}
            <div className="lp-card-back" aria-hidden="true" />{/* the tilted pale-yellow card behind, purely decoration */}
            <div className="lp-card">{/* the white word card itself */}
                <div className="lp-card-top">{/* row: the word on the left, the status chip on the right */}
                    <h3 className="lp-card-word">serendipity</h3>{/* the sample word */}
                    <span className="lp-chip">Review</span>{/* small label showing this word is still being learned */}
                </div>{/* end of <div> */}
                <p className="lp-card-pos">noun</p>{/* part of speech (noun, verb, ...) */}
                <p className="lp-card-meaning">Finding something good by happy accident.</p>{/* the meaning */}
                <p className="lp-card-context">It was pure <mark>serendipity</mark> that she opened that book.</p>{/* the sentence it came from; <mark> highlights the word like a highlighter pen */}
                <div className="lp-card-foot">{/* bottom row: source on the left, share on the right */}
                    <span>My novel.pdf · p. 42</span>{/* which PDF and page the word was found on */}
                    <span className="lp-share"><TbShare3 /> Share</span>{/* a look-only "Share" label (it is a preview, so it is not a real button) */}
                </div>{/* end of <div> */}
            </div>{/* end of <div> */}
        </div> // end of the <div> that wraps this component's markup
    ); // end of what WordCard draws
} // end of WordCard

// Landing = the welcome page people see first at "/".
export default function Landing() { // "export default" lets App.js import this file's main component
    const navigate = useNavigate(); // navigate("/path") changes the page without reloading the browser
    const { status } = useAuth(); // read the login state shared by AuthProvider (parent → child, via context)

    if (status === "in") return <Navigate to="/dashboard" replace />; // already logged in? skip the welcome page; "replace" stops Back from returning here

    return ( // what the page draws
        <div className="lp">{/* the whole page: cream background, centered content */}
            <header className="lp-nav">{/* top bar */}
                <div className="lp-brand">WordKnit.</div>{/* the app name, same style as the sign-in page */}
                <nav className="lp-nav-links" aria-label="Page sections">{/* nav = a group of links; aria-label names it for screen readers */}
                    <a href="#features">Features</a>{/* "#features" jumps to the element with id="features" further down */}
                    <a href="#how">How it works</a>{/* jumps to id="how" */}
                    <Button size="sm" onClick={() => navigate("/login")}>Log in</Button>{/* child → parent: Button calls THIS function when clicked, and we move to the login page */}
                </nav>{/* end of <nav> */}
            </header>{/* end of <header> */}

            <section className="lp-hero">{/* the big top section */}
                <div className="lp-hero-text">{/* left side: words and buttons */}
                    <h1 className="lp-title">Build your <span className="lp-mark">vocab.</span></h1>{/* the headline; the span gets the yellow highlighter look */}
                    <p className="lp-sub">Add words by typing, speaking, or reading PDFs. Understand them in context and make them stick.</p>{/* the one-line explanation */}
                    <div className="lp-actions">{/* row holding the two buttons */}
                        <Button variant="primary" onClick={() => navigate("/register")}>Get started</Button>{/* child → parent: clicking tells us to open the Create account page */}
                        <a href="#features" className="btn btn--secondary">See features</a>{/* a link wearing the button's look by reusing the same CSS classes */}
                    </div>{/* end of <div> */}
                </div>{/* end of <div> */}
                <WordCard />{/* right side: the sample word card */}
            </section>{/* end of <section> */}

            <section id="features" className="lp-section">{/* features block; id is the target of the "#features" links */}
                <h2 className="lp-h2">Everything you need to learn words</h2>{/* section heading */}
                <p className="lp-lead">From the first page you read to saying it out loud.</p>{/* short line under the heading */}
                <div className="lp-grid">{/* a CSS grid: it arranges the items in columns and wraps on small screens */}
                    {FEATURES.map((f) => ( // .map = loop over the array and turn each object into a piece of the page
                        <FeatureItem key={f.title} icon={f.icon} title={f.title} text={f.text} /> // parent → child: pass the data DOWN as props; key helps React track each item in a list
                    ))}{/* end of the loop: every item has been turned into markup */}
                </div>{/* end of <div> */}
            </section>{/* end of <section> */}

            <section id="how" className="lp-section">{/* the how-it-works block */}
                <h2 className="lp-h2">How it works</h2>{/* section heading */}
                <div className="lp-steps">{/* row of the three steps */}
                    {STEPS.map((text, index) => ( // .map gives us each item AND its position (index starts at 0)
                        <Step key={text} number={index + 1} text={text} /> // parent → child: number is index + 1 so people see 1, 2, 3 instead of 0, 1, 2
                    ))}{/* end of the loop: every item has been turned into markup */}
                </div>{/* end of <div> */}
            </section>{/* end of <section> */}

            <section className="lp-cta">{/* the closing call-to-action */}
                <h2 className="lp-h2">Start building your vocab</h2>{/* closing headline */}
                <p className="lp-lead">Free to join. Takes under a minute.</p>{/* reassurance line */}
                <Button variant="primary" onClick={() => navigate("/register")}>Create your account</Button>{/* child → parent: opens the Create account page */}
            </section>{/* end of <section> */}

            <footer className="lp-footer">{/* bottom strip */}
                <span>WordKnit.</span>{/* app name */}
                <span>Read. Look up. Remember.</span>{/* the tagline */}
            </footer>{/* end of <footer> */}
        </div> // end of the <div> that wraps this component's markup
    ); // end of what the page draws
} // end of Landing
