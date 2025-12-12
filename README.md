# Browser AI agent

An AI agent that automates browsing for you<br>
Provide an input and see the result in the browser

## How to run
```
export API_KEY=your_key
export CHROME_BIN_PATH=/path/to/chrome
node gent.js
```

## Implementation
The AI Agent is implemented as a simple console application that handles user's input and forwards it to OpenAI which, then, performs certain actions on the page<br>
Under the hood, it uses two AI models: Main and DOM ones, and playwright for browser automation<br>

## DOM agent
Its main and only goal is to search for the requested elements on the page<br>
It takes DOM snapshots, locates elements in them, and outputs the result CSS selector to Main agent.<br>
A snapshot is a DOM tree structure of TreeNode's
```
type TreeNode = {
    tag:    string
    id?:    number
    cls?:   string[]
    chldn?: TreeNode[]
    attrs?: Record<string, any>
}
```

## Main agent
It's a bridge between a user and DOM agent. It handles the user's input, requests elements from DOM agent and does certain actions on the page based on the demands of the user.<br>
Currently supported actions are:<br>
- Click
- Type


## Security
Main agent can detect any action that adds/deletes/changes some information and ask a user for the permission to perform it.

