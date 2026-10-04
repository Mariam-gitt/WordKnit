import { createElement } from "react"; // createElement builds a React element without needing JSX syntax in this plain data file
import { TbLayoutDashboard, TbBook2, TbFileText, TbCards, TbListCheck, TbMessageCircle } from "react-icons/tb"; // Tabler icon set, already installed via react-icons

// icon(Component) = shortcut that turns an icon component into a ready-to-render 18px icon element,
// so GazetteShell and Navbar can keep rendering {link.icon} exactly as before (an element renders just like text does).
const icon = (Component) => createElement(Component, { size: 18 }); // size 18 = icon width/height in pixels

// NAV_LINKS = the list of sidebar links; every entry has a path (the URL), an icon element and a label (the text shown).
export const NAV_LINKS = [
    { path: "/dashboard",  icon: icon(TbLayoutDashboard), label: "Dashboard" },        // home page with your numbers and quick actions
    { path: "/vocabulary", icon: icon(TbBook2),           label: "My Words" },         // the full word list
    { path: "/reader",     icon: icon(TbFileText),        label: "PDF Reader" },       // read PDFs and add words from them
    { path: "/flashcards", icon: icon(TbCards),           label: "Flashcards" },       // flip-card practice
    { path: "/quiz",       icon: icon(TbListCheck),       label: "Quiz" },             // multiple-choice practice
    { path: "/speaking",   icon: icon(TbMessageCircle),    label: "Speaking Practice" }, // talk with the coach
];
