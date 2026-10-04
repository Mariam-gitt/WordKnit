import React from "react"; // React itself
import ReactDOM from "react-dom/client"; // attaches React to the web page
import "./styles/index.css"; // the whole app's styling (one entry file that loads the others)
import App from "./App"; // the app: routes and pages

// Create the React root on the <div id="root"> in index.html and draw the app inside it.
ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);
