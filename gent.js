import OpenAI from "openai";
import { chromium } from "playwright";
import readline from "readline/promises";

const state = {};

const tools = {
    async openWebsite({ url }) {
        if (!state.ctx) {
            state.ctx = await state.browser.newContext();
        }

        state.page = await state.ctx.newPage();
        state.page.setDefaultTimeout(5000);
        await state.page.goto(url);

        return { type: "input_text", text: "Website has been opened" };
    },

    async takeWebsiteScreenshot() {
        const img = await state.page.screenshot("jpeg", 65);

        return {
            type: "input_image",
            image_url: `data:image/jpeg;base64,${img.toString("base64")}`,
        };
    },

    async takeWebsiteSnapshot({ root = "body", includeRoot = false }) {
        const snapshot = await state.page.evaluate(
            ({ root, includeRoot }) => {
                const forbiddenClasses = [
                    HTMLLinkElement,
                    SVGElement,
                    HTMLImageElement,
                    HTMLPictureElement,
                    HTMLScriptElement,
                    HTMLStyleElement,
                    HTMLIFrameElement,
                    HTMLBRElement,
                    HTMLHeadElement,
                    HTMLMetaElement,
                    HTMLHtmlElement,
                ];

                function isElementHidden(el) {
                    if (!(el instanceof HTMLElement)) return false;
                    if (el.getClientRects().length < 1) return true;

                    const style = window.getComputedStyle(el);

                    return (
                        style.display === "none" ||
                        style.visibility === "hidden" ||
                        style.opacity === "0"
                    );
                }

                function isElementForbidden(el) {
                    if (
                        el.tagName === "NOSCRIPT" ||
                        forbiddenClasses.some((Inst) => el instanceof Inst)
                    ) {
                        return true;
                    }

                    return isElementHidden(el);
                }

                function getAttrs(el) {
                    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
                        const attrs = {};
                        if (el.placeholder) {
                            attrs.placeholder = el.placeholder;
                        }
                        if (el.type) {
                            attrs.type = el.type;
                        }
                        if (el.name) {
                            attrs.name = el.name;
                        }
                        if (el.value) {
                            attrs.value = el.value;
                        }
                        return attrs;
                    }
                    if (el instanceof HTMLAnchorElement) {
                        return { href: el.getAttribute("href") ?? null };
                    }
                    if (el instanceof HTMLLabelElement) {
                        return { for: el.getAttribute("for") ?? null };
                    }
                    return null;
                }

                function nodeAddChild(node, child) {
                    node.chldn ??= [];
                    // To keep the original DOM childern order, prepending the nodes
                    node.chldn.unshift(child);
                }

                function nodeCreate(el) {
                    const node = {
                        tag: el.tagName,
                    };

                    if (el.id) {
                        node.id = el.id;
                    }

                    if (el.classList.length) {
                        node.cls = [...el.classList];
                    }

                    const attrs = getAttrs(el);
                    if (attrs) {
                        node.attrs = attrs;
                    }

                    return node;
                }

                function takeDOMSnapshot(root = document.body, includeRoot = false) {
                    if (isElementForbidden(root)) {
                        return [];
                    }

                    const nodes = [];
                    const elems = [];

                    if (includeRoot) {
                        elems.push({ el: root, parentNode: null });
                    } else {
                        for (const child of root.children) {
                            if (!isElementForbidden(child)) {
                                elems.push({ el: child, parentNode: null });
                            }
                        }
                    }

                    while (elems.length) {
                        const { el, parentNode } = elems.pop();
                        const node = nodeCreate(el);

                        if (parentNode) {
                            nodeAddChild(parentNode, node);
                        } else {
                            nodes.push(node);
                        }

                        for (const child of el.childNodes) {
                            if (isElementForbidden(child)) continue;

                            if (child instanceof Text) {
                                const text = child.nodeValue.trim();
                                if (text) {
                                    nodeAddChild(node, child.nodeValue);
                                }
                            } else if (child instanceof HTMLElement) {
                                elems.push({ el: child, parentNode: node });
                            }
                        }
                    }

                    return nodes;
                }

                return takeDOMSnapshot(document.querySelector(root), includeRoot);
            },
            { root: "body", includeRoot }
        );

        return {
            type: "input_text",
            text: JSON.stringify(snapshot),
        };
    },

    async clickElement({ selector }) {
        await state.page.click(selector);

        try {
            // If the clicked element is an anchor with an external link,
            // substitute current page with the new one
            state.page = await state.ctx.waitForEvent("page", { timeout: 500 });
        } catch {}

        return { type: "input_text", text: "Success" };
    },

    async typeIntoElement({ selector, text }) {
        await state.page.type(selector, text);
        return { type: "input_text", text: "Success" };
    },

    async queryElement({ description }) {
        const output = await state.domAi.ask(`Do a snapshot first. ${description}`);
        return { type: "input_text", text: output };
    },
};

const domAiTools = [
    {
        fn: tools.takeWebsiteSnapshot,
        schema: {
            type: "function",
            name: "website_snapshot",
            description: "Take a snapshot of the website. Returns parsed DOM structure",
            parameters: {
                type: "object",
                required: [],
                properties: {
                    root: {
                        type: "string",
                        description: "Root selector from which to start doing snapshot",
                    },
                    includeRoot: {
                        type: "boolean",
                        description: "Whether the root itself should be included in the snapshot",
                    },
                },
            },
        },
    },
];

const mainAiTools = [
    {
        fn: tools.openWebsite,
        schema: {
            type: "function",
            name: "website_open",
            description: "Open website by URL",
            parameters: {
                type: "object",
                required: ["url"],
                properties: {
                    url: {
                        type: "string",
                        description: "URL of the website to open",
                    },
                },
            },
        },
    },
    {
        fn: tools.takeWebsiteScreenshot,
        schema: {
            type: "function",
            name: "website_screenshot",
            description: "Take currently opened website screenshot",
        },
    },
    {
        fn: tools.clickElement,
        schema: {
            type: "function",
            name: "element_click",
            description: "Click on the HTML element by the provided CSS selector",
            parameters: {
                type: "object",
                required: ["selector"],
                properties: {
                    selector: {
                        type: "string",
                        description: "CSS selector",
                    },
                },
            },
        },
    },
    {
        fn: tools.typeIntoElement,
        schema: {
            type: "function",
            name: "element_type",
            description: "Type a text into HTML element by the provided CSS selector",
            parameters: {
                type: "object",
                required: ["selector", "text"],
                properties: {
                    selector: {
                        type: "string",
                        description: "CSS selector",
                    },
                    text: {
                        type: "string",
                        description: "Text to type",
                    },
                },
            },
        },
    },
    {
        fn: tools.queryElement,
        schema: {
            type: "function",
            name: "element_query",
            description: "Query an element by a description. Returns a selector of that element",
            parameters: {
                type: "object",
                required: ["description"],
                properties: {
                    description: {
                        type: "string",
                        description: "Description of the queried element",
                    },
                },
            },
        },
    },
];

class AIAgent {
    static createSystemInput(content) {
        return { role: "system", content };
    }
    static createUserInput(content) {
        return { role: "user", content };
    }
    static createErrorInput(content) {
        return { type: "input_text", text: `ERROR: ${content}` };
    }
    static createToolInput(callId, output) {
        return {
            type: "function_call_output",
            call_id: callId,
            output,
        };
    }

    constructor({
        input,
        tools,
        label = "Agent",
        logger,
        reasoning,
        model,
        apiKey,
        onAddTool,
        onAnswer,
    }) {
        this.initialInput = [...input];
        this.input = [...this.initialInput];
        this.tools = [...tools];
        this.lock = null;
        this.lockResolve = () => {};
        this.label = label;
        this.reasoning = reasoning;
        this.model = model;
        this.logger = logger;
        this.toolMap = {};
        this.tools = [];
        this.ai = new OpenAI({ apiKey });

        this.onAddTool = onAddTool;
        this.onAnswer = onAnswer;

        for (const tool of tools) {
            this.toolMap[tool.schema.name] = tool.fn;
            this.tools.push(tool.schema);
        }
    }

    createResponse() {
        return this.ai.responses.create({
            model: this.model,
            reasoning: this.reasoning,
            tools: this.tools,
            input: this.input,
            stream: true,
        });
    }

    async dumpData() {
        const fs = await import("fs/promises");

        try {
            await fs.mkdir("./dump");
        } catch {}

        const data = JSON.stringify({
            input: this.input,
            tools: this.tools,
            model: this.model,
            reasoning: this.reasoning,
        });

        await fs.writeFile(`./dump/${Date.now()}.json`, data);
    }

    async ask(query) {
        await this.lock;

        this.input.push(AIAgent.createUserInput(query));

        let done = false;
        let answer = "";

        while (!done) {
            this.lock = new Promise((r) => (this.lockResolve = r));
            const res = await this.createResponse();

            for await (const data of res) {
                if (data.type === "response.output_item.added") {
                    if (data.item.type === "reasoning") {
                        this.logger.log("System: processing the query...");
                        continue;
                    }
                }

                if (data.type !== "response.output_item.done") {
                    continue;
                }

                const tool = data.item;
                this.onAddTool?.({ tool, agent: this });
                this.input.push(tool);

                if (tool.type === "function_call") {
                    this.logger.log(`🔧 Using the tool ${tool.name} with ${tool.arguments}`);

                    const toolFn = this.toolMap[tool.name];

                    if (!toolFn) {
                        const input = AIAgent.createToolInput(tool.call_id, [
                            createErrorInput("Unsupported tool"),
                        ]);
                        this.input.push(input);
                        continue;
                    }

                    try {
                        const result = await toolFn(JSON.parse(tool.arguments));
                        const output = Array.isArray(result) ? result : [result];
                        this.input.push(AIAgent.createToolInput(tool.call_id, output));
                    } catch (err) {
                        this.logger.err(err);
                        const input = AIAgent.createToolInput(tool.call_id, [
                            AIAgent.createErrorInput("Something went wrong"),
                        ]);
                        this.input.push(input);
                    }

                    continue;
                }

                if (tool.type === "message") {
                    answer = tool.content[0].text;
                    done = true;
                    this.logger.log(`${this.label}: ${answer}`);
                    this.onAnswer?.({ agent: this });
                    continue;
                }
            }
        }

        this.lockResolve();

        return answer;
    }

    // Removes the first `count` input tools of `name`
    removeInputTool(name, count = Infinity) {
        let removed = 0;
        let i = 0;
        const result = [];

        while (i < this.input.length) {
            const curr = this.input[i];
            const next = this.input[i + 1];

            if (removed < count) {
                // Input tools are stored in two ways
                // First : [tool call] [tool response]
                // Second: [reasoning] [tool call] [tool response]
                // The next conditions allow it to skip the entire sequence

                if (
                    curr.type === "reasoning" &&
                    next &&
                    next.type === "function_call" &&
                    next.name === name
                ) {
                    i += 3;
                    continue;
                }

                if (curr.type === "function_call" && curr.name === name) {
                    i += 2;
                    continue;
                }
            }

            result.push(curr);
            i += 1;
        }

        this.input = result;
    }
}

class Logger {
    log(text) {
        process.stdout.write(text + "\n");
    }

    err(error) {
        process.stderr.write(`ERROR: ${error.message}\n`);
    }
}

async function main() {
    const apiKey = process.env.API_KEY;
    const chromeBinPath = process.env.CHROME_BIN_PATH

    state.browser = await chromium.launch({
        headless: false,
        executablePath: chromeBinPath
        args: ["--disable-gpu"],
    });

    const logger = new Logger();
    const konsole = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    const mainAi = new AIAgent({
        label: "💀 Agent",
        model: "gpt-5",
        reasoning: { effort: "high" },
        apiKey,
        logger,
        tools: mainAiTools,
        input: [
            AIAgent.createSystemInput(
                "Work in context of a browser. Use provided tools, open pages, search for elements, if asked"
            ),
            AIAgent.createSystemInput(
                "Take screenshots and query an element with the precise description of what you see on the page (if it's in modal, what near elements there are, so on)"
            ),
            AIAgent.createSystemInput("Always take a screenshot before querying an element"),
            AIAgent.createSystemInput(
                "If you see something that user did not specify or unsure what to do next, ask them about further actions"
            ),
            AIAgent.createSystemInput(
                "You must ask the user's permission before modifying, adding, or deleting something if you found a selector"
            ),
        ],

        onAddTool({ tool, agent }) {
            if (tool.name === "website_screenshot") {
                agent.removeInputTool("website_screenshot");
            }
        },
    });

    state.domAi = new AIAgent({
        label: "⚙️ DOM sub-agent",
        model: "gpt-5-mini",
        reasoning: { effort: "low" },
        apiKey,
        logger,
        tools: domAiTools,
        input: [
            AIAgent.createSystemInput("You are a CSS selector finder"),
            AIAgent.createSystemInput("You must do a snapshot before searching for an element"),
            AIAgent.createSystemInput("You must output a single CSS selector"),
            // Some IDs can be invalid when querying them via document.querySelector
            AIAgent.createSystemInput("If a css selector has an ID, use [id=] syntax"),
            AIAgent.createSystemInput("If a selector does not exist, tell the user about that"),
        ],

        onAnswer({ agent }) {
            agent.removeInputTool("website_snapshot");
        },
    });

    while (true) {
        const query = await konsole.question("Query: ");
        if (query === "\\q") break;

        try {
            await mainAi.ask(query);
        } catch (err) {
            await mainAi.dumpData();
            throw err;
        }
    }
}

main();
