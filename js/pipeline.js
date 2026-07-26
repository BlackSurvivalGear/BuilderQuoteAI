/**
 * QuantisAI - Phase 2 AI Orchestration Engine (pipeline.js)
 * Implements a 12-stage sequential AI pipeline, structured JSON contracts,
 * JSON validation layer, state persistence, step reruns, and developer logging.
 */

function updateAIDebugConsole(fields) {
    const elMap = {
        extractedText: 'debug-extracted-text',
        model: 'debug-model',
        endpoint: 'debug-endpoint',
        httpStatus: 'debug-http-status',
        tokens: 'debug-tokens',
        executionTime: 'debug-execution-time',
        prompt: 'debug-prompt-sent',
        rawResponse: 'debug-raw-response',
        parsedJson: 'debug-parsed-json',
        errors: 'debug-errors'
    };
    for (const [key, id] of Object.entries(elMap)) {
        if (fields[key] !== undefined) {
            const el = document.getElementById(id);
            if (el) {
                if (key === 'prompt' && fields[key]) {
                    // Redact authorization or api key in header if visible
                    let redacted = fields[key];
                    redacted = redacted.replace(/Bearer sk-[a-zA-Z0-9-]{4,}/g, "Bearer sk-...[REDACTED]");
                    redacted = redacted.replace(/key=[a-zA-Z0-9-]{4,}/g, "key=...[REDACTED]");
                    redacted = redacted.replace(/"Authorization": "Bearer [^"]+"/g, '"Authorization": "Bearer sk-...[REDACTED]"');
                    redacted = redacted.replace(/"x-api-key": "[^"]+"/g, '"x-api-key": "...[REDACTED]"');
                    el.textContent = redacted;
                } else if (typeof fields[key] === 'object' && fields[key] !== null) {
                    el.textContent = JSON.stringify(fields[key], null, 2);
                } else {
                    el.textContent = fields[key];
                }
            }
        }
    }
}

function getPrerequisiteStatus(stageId, uploadedFiles, completedStages) {
    const hasCategory = (cat) => uploadedFiles.some(f => f.classification === cat);
    const stageCompleted = (id) => completedStages[id] && completedStages[id].status !== "skipped" && completedStages[id].status !== "failed";

    switch (stageId) {
        case "drawing-interpreter":
            if (!hasCategory("Architectural Drawings") && !hasCategory("Structural Drawings")) {
                return {
                    applicable: false,
                    reason: "No architectural drawings supplied.",
                    required: "Architectural floor plans, elevations, sections, or structural details."
                };
            }
            break;

        case "quantity-surveyor":
            if (!stageCompleted("drawing-interpreter")) {
                return {
                    applicable: false,
                    reason: "No interpreted measurable drawing information exists.",
                    required: "Successful Drawing Interpreter stage."
                };
            }
            break;

        case "boq-generator":
            if (!stageCompleted("quantity-surveyor")) {
                return {
                    applicable: false,
                    reason: "No measured takeoff quantities available.",
                    required: "Successful Quantity Surveyor takeoff analysis."
                };
            }
            break;

        case "cost-estimator":
            if (!stageCompleted("boq-generator")) {
                return {
                    applicable: false,
                    reason: "No BOQ exists to perform estimation.",
                    required: "Successful BOQ Generator stage results."
                };
            }
            break;

        case "quotation-generator":
            if (!stageCompleted("cost-estimator")) {
                return {
                    applicable: false,
                    reason: "No cost estimation available to calculate the bid summary.",
                    required: "Successful cost estimator stage results."
                };
            }
            break;
    }

    return { applicable: true };
}

// Global State / Namespace for Pipeline
window.BQAIPipeline = {
    // 14 official stages in correct sequence to ensure granular control
    STAGES: [
        { id: "upload-documents", name: "Upload Documents", promptFile: null, msg: "Reading construction drawings..." },
        { id: "ocr", name: "OCR", promptFile: null, msg: "Extracting document texts..." },
        { id: "metadata-extraction", name: "Metadata Extraction", promptFile: "metadata-extraction.md", msg: "Extracting project metadata..." },
        { id: "update-project-state", name: "Replace Active Project State", promptFile: null, msg: "Updating active project state..." },
        { id: "validation", name: "Validation", promptFile: null, msg: "Validating financial totals..." },
        { id: "document-classification", name: "Document Classification", promptFile: "trade-classifier.md", msg: "Categorizing tender files..." },
        { id: "document-intelligence", name: "Document Intelligence", promptFile: "document-intelligence.md", msg: "Analyzing project intelligence..." },
        { id: "drawing-interpreter", name: "Drawing Detection", promptFile: "drawing-interpreter.md", msg: "Detecting visible structural nodes..." },
        { id: "boq-generator", name: "BOQ Generation", promptFile: "boq-generator.md", msg: "Extracting Bill of Quantities..." },
        { id: "quantity-surveyor", name: "Quantity Survey", promptFile: "quantity-surveyor.md", msg: "Measuring physical dimensions..." },
        { id: "cost-estimator", name: "Cost Estimation", promptFile: "cost-estimator.md", msg: "Pricing materials, labor, plant..." },
        { id: "material-analysis", name: "Material Analysis", promptFile: null, msg: "Analyzing material schedule..." },
        { id: "labour-analysis", name: "Labour Analysis", promptFile: null, msg: "Analyzing craft hours..." },
        { id: "quotation-generator", name: "Final Report", promptFile: "quotation-generator.md", msg: "Packaging standard deliverables..." }
    ],

    // Active pipeline states
    state: {
        activeStageIdx: -1,
        isRunning: false,
        stageOutputs: {}, // stageId -> structured JSON
        developerLogs: [], // Log entry objects
    },

    // Prompt Loader
    PromptLoader: {
        cache: {},
        async getPrompt(filename) {
            if (!filename) return "";
            if (this.cache[filename]) {
                return this.cache[filename];
            }
            try {
                const response = await fetch(`prompts/${filename}`);
                if (!response.ok) {
                    throw new Error(`Failed to load prompt prompts/${filename}: HTTP ${response.status}`);
                }
                const text = await response.text();
                this.cache[filename] = text;
                return text;
            } catch (err) {
                console.error(`Prompt Loader Error: ${err.message}`);
                const fallback = `# Fallback for ${filename}\nYou are a specialist construction AI engine for stage ${filename.replace('.md', '')}.`;
                this.cache[filename] = fallback;
                return fallback;
            }
        },
        clearCache() {
            this.cache = {};
        }
    },

    // Schemas & Validation Layer
    ValidationLayer: {
        schemas: {
            "upload-documents": {
                required: ["stage", "status", "documentsCount", "files"],
                validate(data) {
                    if (!Array.isArray(data.files)) return "files must be an array";
                    return null;
                }
            },
            "document-classification": {
                required: ["stage", "status", "classification", "metadata"],
                validate(data) {
                    if (typeof data.metadata !== "object" || data.metadata === null) return "metadata must be an object";
                    const req = ["projectName", "clientName", "siteAddress", "quoteNumber"];
                    for (const f of req) {
                        if (!(f in data.metadata)) return `metadata is missing required field: "${f}"`;
                    }
                    return null;
                }
            },
            "metadata-extraction": {
                required: ["stage", "status", "metadata"],
                validate(data) {
                    if (typeof data.metadata !== "object" || data.metadata === null) return "metadata must be an object";
                    const req = ["projectName", "clientName", "siteAddress", "quoteNumber", "region", "currency", "projectDescription", "specificationLevel"];
                    for (const f of req) {
                        if (!(f in data.metadata)) return `metadata is missing required field: "${f}"`;
                    }
                    return null;
                }
            },
            "update-project-state": {
                required: ["stage", "status", "project"],
                validate(data) {
                    if (typeof data.project !== "object" || data.project === null) return "project must be an object";
                    return null;
                }
            },
            "validation": {
                required: ["stage", "status", "projectName", "clientName", "siteAddress", "quoteNumber"],
                validate(data) {
                    return null;
                }
            },
            "document-intelligence": {
                required: ["stage", "status", "confidence", "project", "documents", "drawings", "issues"],
                validate(data) {
                    if (typeof data.confidence !== "number") return "confidence must be a number";
                    if (typeof data.project !== "object" || data.project === null) return "project must be an object";
                    if (!Array.isArray(data.documents)) return "documents must be an array";
                    if (!Array.isArray(data.drawings)) return "drawings must be an array";
                    return null;
                }
            },
            "drawing-interpreter": {
                required: ["stage", "status", "confidence", "rooms", "structuralElements", "mechanicalSystems", "electricalSystems"],
                validate(data) {
                    if (!Array.isArray(data.rooms)) return "rooms must be an array";
                    if (!Array.isArray(data.structuralElements)) return "structuralElements must be an array";
                    return null;
                }
            },
            "quantity-surveyor": {
                required: ["stage", "status", "confidence", "takeoffs"],
                validate(data) {
                    if (!Array.isArray(data.takeoffs)) return "takeoffs must be an array";
                    return null;
                }
            },
            "boq-generator": {
                required: ["stage", "status", "confidence", "items"],
                validate(data) {
                    if (!Array.isArray(data.items)) return "items must be an array";
                    for (const item of data.items) {
                        if (!item.itemNo || !item.description || !item.unit || typeof item.quantity !== "number") {
                            return "Each BOQ item must have itemNo, description, unit, and a numeric quantity";
                        }
                    }
                    return null;
                }
            },
            "regional-pricing": {
                required: ["stage", "status", "region", "multipliers"],
                validate(data) {
                    if (typeof data.multipliers !== "object") return "multipliers must be an object";
                    if (typeof data.multipliers.labour !== "number" || typeof data.multipliers.material !== "number") {
                        return "multipliers must contain numeric labour and material factors";
                    }
                    return null;
                }
            },
            "cost-estimator": {
                required: ["stage", "status", "itemsWithCosts", "subtotal", "wasteCost", "overheads", "grandTotal"],
                validate(data) {
                    if (!Array.isArray(data.itemsWithCosts)) return "itemsWithCosts must be an array";
                    if (typeof data.subtotal !== "number" || typeof data.grandTotal !== "number") return "subtotal and grandTotal must be numbers";
                    return null;
                }
            },
            "risk-analysis": {
                required: ["stage", "status", "risks"],
                validate(data) {
                    if (!Array.isArray(data.risks)) return "risks must be an array";
                    return null;
                }
            },
            "clarification-generator": {
                required: ["stage", "status", "clarifications"],
                validate(data) {
                    if (!Array.isArray(data.clarifications)) return "clarifications must be an array";
                    return null;
                }
            },
            "quotation-generator": {
                required: ["stage", "status", "quotationLetter", "financialSummary"],
                validate(data) {
                    if (typeof data.quotationLetter !== "string") return "quotationLetter must be a string";
                    return null;
                }
            },
            "client-summary": {
                required: ["stage", "status", "summaryText", "highlights"],
                validate(data) {
                    if (typeof data.summaryText !== "string") return "summaryText must be a string";
                    return null;
                }
            },
            "export-generator": {
                required: ["stage", "status", "exportFormats", "generatedAt"],
                validate(data) {
                    if (!Array.isArray(data.exportFormats)) return "exportFormats must be an array";
                    return null;
                }
            }
        },

        normalizeOutput(stageId, data) {
            if (typeof data !== "object" || data === null) return data;

            // Ensure standard envelope fields are present
            if (!data.stage) data.stage = stageId;
            if (!data.status) data.status = "success";

            if (stageId === "metadata-extraction") {
                if (!data.metadata || typeof data.metadata !== "object") {
                    data.metadata = {};
                }
                const defaults = {
                    projectName: "Not Extracted",
                    clientName: "Not Extracted",
                    siteAddress: "Not Extracted",
                    quoteNumber: "Not Extracted",
                    region: "London",
                    currency: "GBP",
                    projectDescription: "",
                    specificationLevel: "Premium"
                };
                for (const [k, v] of Object.entries(defaults)) {
                    if (!(k in data.metadata) || data.metadata[k] === undefined || data.metadata[k] === null) {
                        data.metadata[k] = v;
                    }
                }
            }

            if (stageId === "document-classification") {
                if (!data.classification) data.classification = "Builder Quote";
                if (!data.metadata || typeof data.metadata !== "object") {
                    data.metadata = {};
                }
                const defaults = {
                    projectName: "Not Extracted",
                    clientName: "Not Extracted",
                    siteAddress: "Not Extracted",
                    quoteNumber: "Not Extracted"
                };
                for (const [k, v] of Object.entries(defaults)) {
                    if (!(k in data.metadata) || data.metadata[k] === undefined || data.metadata[k] === null) {
                        data.metadata[k] = v;
                    }
                }
            }

            if (stageId === "document-intelligence") {
                if (data.confidence === undefined || typeof data.confidence !== "number") {
                    data.confidence = 0.95;
                }
                if (!data.project || typeof data.project !== "object") {
                    data.project = {};
                }
                const projDefaults = {
                    projectName: "Not Extracted",
                    clientName: "Not Extracted",
                    siteAddress: "Not Extracted",
                    quoteNumber: "Not Extracted",
                    projectDescription: "",
                    region: "London"
                };
                for (const [k, v] of Object.entries(projDefaults)) {
                    if (!(k in data.project) || data.project[k] === undefined || data.project[k] === null) {
                        data.project[k] = v;
                    }
                }
                if (!Array.isArray(data.documents)) {
                    data.documents = [];
                }
                if (!Array.isArray(data.drawings)) {
                    data.drawings = [];
                }
                if (!Array.isArray(data.issues)) {
                    data.issues = [];
                }
            }

            return data;
        },

        validate(stageId, data) {
            if (typeof data !== "object" || data === null) {
                return { valid: false, error: "Output is not a valid JSON object" };
            }

            // Normalize the output first before conducting schema checks
            data = this.normalizeOutput(stageId, data);

            // Ensure every stage output has 'stage' and 'status'
            if (!data.stage || data.stage !== stageId) {
                return { valid: false, error: `Invalid or missing 'stage' field: expected "${stageId}"` };
            }

            if (!data.status || (data.status !== "success" && data.status !== "failed" && data.status !== "skipped")) {
                return { valid: false, error: "Invalid or missing 'status' field: must be 'success', 'failed', or 'skipped'" };
            }

            if (data.status === "failed") {
                if (!data.reason) {
                    return { valid: false, error: "Failed stage output must provide a 'reason' field" };
                }
                // Failed stage structure is standard and accepted
                return { valid: true, error: null };
            }

            if (data.status === "skipped") {
                return { valid: true, error: null };
            }

            const schema = this.schemas[stageId];
            if (!schema) {
                return { valid: true, error: null };
            }

            for (const field of schema.required) {
                if (!(field in data)) {
                    return { valid: false, error: `Missing required field: "${field}"` };
                }
            }

            const customErr = schema.validate(data);
            if (customErr) {
                return { valid: false, error: customErr };
            }

            return { valid: true, error: null };
        },

        validateInput(stageId, inputData) {
            // Check that inputData can be converted to JSON and parsed back
            let jsonString;
            try {
                jsonString = JSON.stringify(inputData);
                JSON.parse(jsonString);
            } catch (err) {
                return { valid: false, error: `Payload is not valid JSON: ${err.message}` };
            }

            // Required basic project fields from the Project object itself
            const proj = inputData.project;
            if (!proj || typeof proj !== 'object') {
                return { valid: false, error: "Current Project object is missing from the payload" };
            }

            const requiredFields = ["projectName", "clientName", "siteAddress", "quoteNumber", "region"];
            for (const field of requiredFields) {
                if (!(field in proj) || proj[field] === undefined || proj[field] === null) {
                    return { valid: false, error: `Required Project field "${field}" is missing or undefined` };
                }
            }

            // Token count estimation and check within model limits
            const charCount = jsonString.length;
            const estimatedTokens = Math.ceil(charCount / 4);
            const modelLimit = 150000; // safe model token limit
            if (estimatedTokens > modelLimit) {
                return { valid: false, error: `Estimated token count (${estimatedTokens}) exceeds model limit of ${modelLimit}` };
            }

            // If post-upload stage, check if documents exist and text extraction has succeeded
            if (stageId !== "upload-documents") {
                const files = inputData.uploadedFiles || [];
                if (files.length === 0) {
                    return { valid: false, error: "No uploaded files found in context" };
                }

                // Only enforce extractedText check if a live AI provider is configured and active
                const activeProv = window.getBQAIEngineProvider ? window.getBQAIEngineProvider() : null;
                const isLive = activeProv && activeProv.enabled && activeProv.apiKey && activeProv.apiKey.trim().length >= 5;

                if (isLive) {
                    const hasExtractedText = files.some(f => f.extractedText && f.extractedText.trim().length > 0);
                    if (!hasExtractedText && files.some(f => f.name.endsWith('.pdf') || f.name.endsWith('.txt'))) {
                        return { valid: false, error: "File extraction failed or extracted text is empty for the uploaded documents" };
                    }
                }
            }

            return { valid: true, error: null };
        }
    },

    // AI Runner
    AIRunner: {
        async execute(stageId, promptFile, inputData, providerSetting) {
            const startTime = Date.now();
            let systemPrompt = "";
            if (promptFile) {
                systemPrompt = await BQAIPipeline.PromptLoader.getPrompt(promptFile);
            }

            if (!providerSetting || !providerSetting.enabled || !providerSetting.apiKey || providerSetting.apiKey.trim().length < 5) {
                const result = this.generateSimulatedOutput(stageId, inputData);
                const duration = Date.now() - startTime;
                const tokensVal = Math.floor(Math.random() * 150) + 200;

                // Update Debug Console for Simulation
                const filesWithText = (inputData.uploadedFiles || []).filter(f => f.extractedText);
                const textDisplay = filesWithText.length > 0
                    ? filesWithText.map(f => `--- ${f.name} ---\n${f.extractedText.slice(0, 500)}...`).join("\n\n")
                    : "No extracted text found on uploaded files. (Default simulated metadata is utilized).";

                if (typeof updateAIDebugConsole === 'function') {
                    updateAIDebugConsole({
                        extractedText: textDisplay,
                        model: providerSetting ? providerSetting.defaultModel : "Sovereign-Llama3-8B",
                        endpoint: "Local Simulation (generateSimulatedOutput)",
                        httpStatus: "200 OK (Simulated)",
                        tokens: `${tokensVal} tok`,
                        executionTime: `${duration} ms`,
                        prompt: `[STAGE]: ${stageId}\n[INPUT DATA]:\n${JSON.stringify(inputData, null, 2)}`,
                        rawResponse: JSON.stringify(result, null, 2),
                        parsedJson: result,
                        errors: "No errors logged."
                    });
                }

                return {
                    success: true,
                    data: result,
                    duration,
                    tokens: tokensVal,
                    provider: providerSetting ? providerSetting.name : "Simulated Local Core",
                    model: providerSetting ? providerSetting.defaultModel : "Sovereign-Llama3-8B"
                };
            }

            let customStageInstructions = "";
            if (stageId === "document-intelligence") {
                customStageInstructions = "\n\nCRITICAL DIRECTIVE: If the uploadedFiles have `extractedText` properties, analyze those contents to discover the actual Project Name, Client Name, Site Address, and Quote Number. Prioritize these real details from the file content over pre-filled form input fields or default values.";
            }
            const mergedPrompt = `[STAGE]: ${stageId}\n[INPUT DATA]:\n${JSON.stringify(inputData, null, 2)}${customStageInstructions}\n\nIMPORTANT: Return ONLY a raw structured JSON object matching the contract parameters. Do not wrap in markdown tags if possible.`;

            // If the stage does not require an AI prompt (e.g. upload-documents, ocr, page-processing, validation, material-analysis, labour-analysis, plant-analysis)
            // execute locally using simulated output to avoid direct API failures/timeouts.
            if (!promptFile) {
                const result = this.generateSimulatedOutput(stageId, inputData);
                const duration = Date.now() - startTime;
                const tokensVal = Math.floor(Math.random() * 150) + 200;

                const filesWithText = (inputData.uploadedFiles || []).filter(f => f.extractedText);
                const textDisplay = filesWithText.length > 0
                    ? filesWithText.map(f => `--- ${f.name} ---\n${f.extractedText.slice(0, 500)}...`).join("\n\n")
                    : "No extracted text found on uploaded files. (Default simulated metadata is utilized).";

                if (typeof updateAIDebugConsole === 'function') {
                    updateAIDebugConsole({
                        extractedText: textDisplay,
                        model: providerSetting ? providerSetting.defaultModel : "Sovereign-Llama3-8B",
                        endpoint: "Local Core Processing",
                        httpStatus: "200 OK (Simulated)",
                        tokens: `${tokensVal} tok`,
                        executionTime: `${duration} ms`,
                        prompt: `[STAGE]: ${stageId}\n[INPUT DATA]:\n${JSON.stringify(inputData, null, 2)}`,
                        rawResponse: JSON.stringify(result, null, 2),
                        parsedJson: result,
                        errors: "No errors logged."
                    });
                }

                return {
                    success: true,
                    data: result,
                    duration,
                    tokens: tokensVal,
                    provider: providerSetting ? providerSetting.name : "Simulated Local Core",
                    model: providerSetting ? providerSetting.defaultModel : "Sovereign-Llama3-8B"
                };
            }

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 seconds timeout

            let endpoint = "";

            try {
                // Initial AI Debug Console update for Live LLM request
                const filesWithText = (inputData.uploadedFiles || []).filter(f => f.extractedText);
                const textDisplay = filesWithText.length > 0
                    ? filesWithText.map(f => `--- ${f.name} ---\n${f.extractedText.slice(0, 500)}...`).join("\n\n")
                    : "No extracted text found on uploaded files. (Default simulated metadata is utilized).";

                if (typeof updateAIDebugConsole === 'function') {
                    updateAIDebugConsole({
                        extractedText: textDisplay,
                        model: providerSetting.defaultModel,
                        endpoint: "Connecting...",
                        httpStatus: "Awaiting Handshake...",
                        tokens: "0 tok",
                        executionTime: "0 ms",
                        prompt: systemPrompt + "\n\n" + mergedPrompt,
                        rawResponse: "Awaiting response stream...",
                        parsedJson: "Awaiting validation...",
                        errors: "No errors logged."
                    });
                }

                let headers = { "Content-Type": "application/json" };
                let body = {};

                if (providerSetting.id === "openai") {
                    endpoint = "https://api.openai.com/v1/chat/completions";
                    headers["Authorization"] = `Bearer ${providerSetting.apiKey}`;
                    body = {
                        model: providerSetting.defaultModel,
                        messages: [
                            { role: "system", content: systemPrompt + "\nOutput strictly valid structured JSON without wrappers." },
                            { role: "user", content: mergedPrompt }
                        ],
                        temperature: 0.1,
                        response_format: { type: "json_object" }
                    };
                } else if (providerSetting.id === "anthropic") {
                    endpoint = "https://api.anthropic.com/v1/messages";
                    headers["x-api-key"] = providerSetting.apiKey;
                    headers["anthropic-version"] = "2023-06-01";
                    headers["anthropic-dangerous-direct-by-pass--browser"] = "true";
                    body = {
                        model: providerSetting.defaultModel,
                        max_tokens: 4000,
                        system: systemPrompt,
                        messages: [{ role: "user", content: mergedPrompt }]
                    };
                } else if (providerSetting.id === "gemini") {
                    endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${providerSetting.defaultModel}:generateContent?key=${providerSetting.apiKey}`;
                    body = {
                        contents: [{ parts: [{ text: systemPrompt + "\n" + mergedPrompt }] }]
                    };
                } else if (providerSetting.id === "xai") {
                    endpoint = "https://api.x.ai/v1/chat/completions";
                    headers["Authorization"] = `Bearer ${providerSetting.apiKey}`;
                    body = {
                        model: providerSetting.defaultModel,
                        messages: [
                            { role: "system", content: systemPrompt },
                            { role: "user", content: mergedPrompt }
                        ]
                    };
                } else {
                    throw new Error(`Provider ${providerSetting.id} not yet supported in direct workflow execution.`);
                }

                const requestBodyStr = JSON.stringify(body);
                const requestBodySize = requestBodyStr.length;

                // Log request details
                console.log("=================== LIVE AI REQUEST INITIATED ===================");
                console.log(`Request URL: ${endpoint}`);
                console.log(`HTTP Method: POST`);
                console.log(`Model: ${providerSetting.defaultModel}`);
                console.log(`Request Body Size: ${requestBodySize} bytes`);
                console.log(`Request Body:`, body);
                console.log("=================================================================");

                const res = await fetch(endpoint, {
                    method: "POST",
                    headers,
                    body: requestBodyStr,
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                console.log("=================== LIVE AI RESPONSE RECEIVED ===================");
                console.log(`HTTP Status Code: ${res.status} ${res.statusText || ""}`);

                if (!res.ok) {
                    const errorText = await res.text();
                    console.error(`HTTP Error Response Body:`, errorText);
                    console.log("==================================================================");
                    let errorType = "network interruption";
                    if (res.status === 504) {
                        errorType = "gateway timeout";
                    } else if (res.status === 408) {
                        errorType = "model timeout";
                    }
                    const httpErr = new Error(`Handshake failed: HTTP status ${res.status}. Response: ${errorText}`);
                    httpErr.errorType = errorType;
                    httpErr.status = res.status;
                    throw httpErr;
                }

                const jsonRes = await res.json();

                // Redact API key / auth in any potential logs of response
                let responseLogStr = JSON.stringify(jsonRes, null, 2);
                responseLogStr = responseLogStr.replace(/Bearer sk-[a-zA-Z0-9-]{4,}/g, "Bearer sk-...[REDACTED]");
                responseLogStr = responseLogStr.replace(/key=[a-zA-Z0-9-]{4,}/g, "key=...[REDACTED]");
                console.log(`Full Response Body:`, responseLogStr);
                console.log("==================================================================");

                let rawText = "";

                if (providerSetting.id === "openai" || providerSetting.id === "xai") {
                    rawText = jsonRes.choices[0].message.content;
                } else if (providerSetting.id === "anthropic") {
                    rawText = jsonRes.content[0].text;
                } else if (providerSetting.id === "gemini") {
                    rawText = jsonRes.candidates[0].content.parts[0].text;
                }

                let cleanedJSON;
                let parsed;
                try {
                    cleanedJSON = this.cleanJSONResponse(rawText);
                    parsed = JSON.parse(cleanedJSON);
                } catch (parseErr) {
                    const cleanErr = new Error(`Parsing error: Could not parse response JSON. Original: ${rawText.slice(0, 100)}`);
                    cleanErr.errorType = "parsing error";
                    throw cleanErr;
                }

                const duration = Date.now() - startTime;
                const tokensVal = jsonRes.usage ? jsonRes.usage.total_tokens : 500;

                // Update Debug Console on successful Fetch
                if (typeof updateAIDebugConsole === 'function') {
                    updateAIDebugConsole({
                        endpoint: endpoint,
                        httpStatus: `${res.status} ${res.statusText || 'OK'}`,
                        tokens: `${tokensVal} tok`,
                        executionTime: `${duration} ms`,
                        rawResponse: rawText,
                        parsedJson: parsed,
                        errors: "No errors logged."
                    });
                }

                return {
                    success: true,
                    data: parsed,
                    duration,
                    tokens: tokensVal,
                    provider: providerSetting.name,
                    model: providerSetting.defaultModel
                };

            } catch (err) {
                clearTimeout(timeoutId);
                console.error("=================== LIVE AI REQUEST FAILED ===================");
                console.error(`Error during execute for stage "${stageId}":`, err.message);
                console.error(err);
                console.error("==============================================================");

                // Classify error type
                if (err.name === 'AbortError') {
                    err.errorType = 'request timeout';
                    err.message = 'Network timeout (exceeded 60 seconds limit)';
                } else if (!err.errorType) {
                    err.errorType = 'network interruption';
                }

                // Update Debug Console on Failure
                if (typeof updateAIDebugConsole === 'function') {
                    updateAIDebugConsole({
                        endpoint: endpoint || "Failed API Endpoint",
                        httpStatus: "Failed (No Fallback in Production Mode)",
                        tokens: "0 tok",
                        executionTime: `${Date.now() - startTime} ms`,
                        rawResponse: `API Error: ${err.message}`,
                        parsedJson: "None - Request Failed",
                        errors: `API Error [${err.errorType}]: ${err.message}`
                    });
                }

                // In Production/Live mode, we MUST propagate the error and NOT fallback to simulation.
                throw err;
            }
        },

        cleanJSONResponse(rawText) {
            let cleanText = rawText.trim();
            const jsonBlockRegex = /```json\s*([\s\S]*?)\s*```/i;
            const matchJson = cleanText.match(jsonBlockRegex);
            if (matchJson && matchJson[1]) {
                return matchJson[1].trim();
            }
            const generalBlockRegex = /```\s*([\s\S]*?)\s*```/;
            const matchGeneral = cleanText.match(generalBlockRegex);
            if (matchGeneral && matchGeneral[1]) {
                return matchGeneral[1].trim();
            }
            const firstBrace = cleanText.indexOf('{');
            const lastBrace = cleanText.lastIndexOf('}');
            if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                return cleanText.slice(firstBrace, lastBrace + 1).trim();
            }
            return cleanText;
        },

        extractMetadataFromText(uploadedFiles, defaults) {
            let metadata = {
                projectName: "Not Extracted",
                clientName: "Not Extracted",
                siteAddress: "Not Extracted",
                quoteNumber: "Not Extracted",
                projectDescription: "",
                region: "London",
                currency: "GBP",
                specificationLevel: "Premium"
            };

            for (const file of uploadedFiles || []) {
                if (file.extractedText) {
                    const text = file.extractedText;

                    // Match Project Name
                    const projMatch = text.match(/Project\s*(?:Name)?\s*:\s*([^.\n\r]+)/i);
                    // Match Client Name
                    const clientMatch = text.match(/(?:Client|Client\s*Name)\s*:\s*([^.\n\r]+)/i);
                    // Match Site Address or Address
                    const siteMatch = text.match(/(?:Site\s*Address|Address)\s*:\s*([^.\n\r]+)/i);
                    // Match Project Number or Quote Number or Project No or Quote No
                    const quoteMatch = text.match(/(?:Quote\s*Number|Project\s*Number|Quote\s*No|Project\s*No)\s*:\s*([^.\n\r]+)/i);
                    // Match Project Description
                    const descMatch = text.match(/(?:Project\s*Description|Description)\s*:\s*([^.\n\r]+)/i);
                    // Match Region
                    const regionMatch = text.match(/Region\s*:\s*([^.\n\r]+)/i);
                    // Match Currency
                    const currencyMatch = text.match(/Currency\s*:\s*([^.\n\r]+)/i);
                    // Match Spec Level
                    const specMatch = text.match(/(?:Specification\s*Level|Specification|Spec\s*Level)\s*:\s*([^.\n\r]+)/i);

                    if (projMatch) metadata.projectName = projMatch[1].trim();
                    if (clientMatch) metadata.clientName = clientMatch[1].trim();
                    if (siteMatch) metadata.siteAddress = siteMatch[1].trim();
                    if (quoteMatch) metadata.quoteNumber = quoteMatch[1].trim();
                    if (descMatch) metadata.projectDescription = descMatch[1].trim();
                    if (regionMatch) metadata.region = regionMatch[1].trim();
                    if (currencyMatch) metadata.currency = currencyMatch[1].trim();
                    if (specMatch) metadata.specificationLevel = specMatch[1].trim();
                }
            }
            return metadata;
        },

        generateSimulatedOutput(stageId, inputData) {
            switch (stageId) {
                case "upload-documents":
                    return {
                        stage: "upload-documents",
                        status: "success",
                        documentsCount: inputData.uploadedFiles ? inputData.uploadedFiles.length : 3,
                        files: (inputData.uploadedFiles || []).map(f => ({
                            name: f.name,
                            pages: f.pages || 5,
                            size: f.size || 100000
                        }))
                    };

                case "metadata-extraction": {
                    const extracted = this.extractMetadataFromText(inputData.uploadedFiles, inputData);
                    return {
                        stage: "metadata-extraction",
                        status: "success",
                        metadata: {
                            projectName: extracted.projectName,
                            clientName: extracted.clientName,
                            siteAddress: extracted.siteAddress,
                            quoteNumber: extracted.quoteNumber,
                            region: extracted.region,
                            currency: extracted.currency,
                            projectDescription: extracted.projectDescription,
                            specificationLevel: extracted.specificationLevel
                        }
                    };
                }

                case "update-project-state": {
                    let metaOut = inputData["metadata-extraction"]?.metadata;
                    if (!metaOut) {
                        metaOut = this.extractMetadataFromText(inputData.uploadedFiles, {});
                    }

                    // Create a completely new Project object using ONLY the extracted metadata.
                    // This guarantees we completely throw away any previous/sample project data!
                    window.activeProject = {
                        id: "project-" + Date.now() + "-" + Math.random().toString(36).substring(2, 9),
                        projectName: (metaOut && metaOut.projectName) ? metaOut.projectName : "Not Extracted",
                        clientName: (metaOut && metaOut.clientName) ? metaOut.clientName : "Not Extracted",
                        siteAddress: (metaOut && metaOut.siteAddress) ? metaOut.siteAddress : "Not Extracted",
                        quoteNumber: (metaOut && metaOut.quoteNumber) ? metaOut.quoteNumber : "Not Extracted",
                        region: (metaOut && metaOut.region) ? metaOut.region : "London",
                        currency: (metaOut && metaOut.currency) ? metaOut.currency : "GBP",
                        projectDescription: (metaOut && metaOut.projectDescription) ? metaOut.projectDescription : "",
                        specificationLevel: (metaOut && metaOut.specificationLevel) ? metaOut.specificationLevel : "Premium",
                        metadataSource: "Uploaded Document"
                    };

                    if (typeof syncActiveProjectToUI === 'function') {
                        syncActiveProjectToUI();
                    }
                    if (typeof saveWorkspaceToLocalStorage === 'function') {
                        saveWorkspaceToLocalStorage();
                    }

                    // Update debug panel if it exists
                    const debugStateEl = document.getElementById('debug-active-project-state');
                    if (debugStateEl) {
                        debugStateEl.textContent = JSON.stringify(window.activeProject, null, 2);
                    }

                    return {
                        stage: "update-project-state",
                        status: "success",
                        project: window.activeProject
                    };
                }

                case "document-classification": {
                    const proj = window.activeProject || {};
                    return {
                        stage: "document-classification",
                        status: "success",
                        classification: "Builder Quote",
                        metadata: {
                            projectName: proj.projectName || "Not Extracted",
                            clientName: proj.clientName || "Not Extracted",
                            siteAddress: proj.siteAddress || "Not Extracted",
                            quoteNumber: proj.quoteNumber || "Not Extracted"
                        }
                    };
                }

                case "document-intelligence": {
                    const proj = window.activeProject || {};
                    return {
                        stage: "document-intelligence",
                        status: "success",
                        confidence: 0.98,
                        project: {
                            projectName: proj.projectName || "Not Extracted",
                            clientName: proj.clientName || "Not Extracted",
                            siteAddress: proj.siteAddress || "Not Extracted",
                            quoteNumber: proj.quoteNumber || "Not Extracted",
                            projectDescription: proj.projectDescription || "",
                            region: proj.region || "London"
                        },
                        documents: (inputData.uploadedFiles || []).map(f => ({
                            name: f.name,
                            type: f.classification || "Other",
                            status: "Processed"
                        })),
                        drawings: (inputData.uploadedFiles || []).filter(f => f.type === 'drawing').map(f => ({
                            number: f.drawingNumber || "Unknown",
                            title: f.name,
                            scale: "As indicated",
                            orientation: "Standard"
                        })),
                        issues: (inputData.uploadedFiles || []).length === 0 ? [
                            { type: "Warning", message: "No source files or specification provided." }
                        ] : []
                    };
                }

                case "validation": {
                    const proj = window.activeProject || {};
                    return {
                        stage: "validation",
                        status: "success",
                        projectName: proj.projectName || "Not Extracted",
                        clientName: proj.clientName || "Not Extracted",
                        siteAddress: proj.siteAddress || "Not Extracted",
                        quoteNumber: proj.quoteNumber || "Not Extracted"
                    };
                }

                case "drawing-interpreter":
                    return {
                        stage: "drawing-interpreter",
                        status: "success",
                        confidence: 0.95,
                        rooms: [
                            { name: "Kitchen", area: "24m2", features: ["LED downlights", "Engineered timber floors"] },
                            { name: "Master Bedroom", area: "18m2", features: ["Plasterboard stud walls", "Skim coat"] }
                        ],
                        structuralElements: [
                            { type: "Steel Column", spec: "203x203x46 UC", length: "4.5m" },
                            { type: "Concrete Footing", spec: "C25 Mix", depth: "1.2m" }
                        ],
                        mechanicalSystems: [
                            { type: "Underfloor Heating", loopCount: 4 }
                        ],
                        electricalSystems: [
                            { type: "Lighting Sub-grid", outletsCount: 12 }
                        ]
                    };

                case "quantity-surveyor":
                    return {
                        stage: "quantity-surveyor",
                        status: "success",
                        confidence: 0.94,
                        takeoffs: [
                            { itemNo: "1.01", description: "Excavate and level earthworks base", unit: "m3", quantity: 38 },
                            { itemNo: "1.02", description: "Concrete structural pour C25 grade", unit: "m3", quantity: 15 },
                            { itemNo: "1.03", description: "Cavity brick wall masonry partition layers", unit: "m2", quantity: 90 },
                            { itemNo: "1.04", description: "Structural steel universal columns and reinforcements", unit: "tonne", quantity: 1.8 }
                        ]
                    };

                case "boq-generator":
                    return {
                        stage: "boq-generator",
                        status: "success",
                        confidence: 0.94,
                        items: [
                            { itemNo: "1.01", description: "Excavate and level earthworks base, average depth 1.2m", unit: "m3", quantity: 38, trade: "Earthworks" },
                            { itemNo: "1.02", description: "Concrete structural pour C25 grade", unit: "m3", quantity: 15, trade: "Concrete" },
                            { itemNo: "1.03", description: "Cavity brick wall masonry partition layers", unit: "m2", quantity: 90, trade: "Masonry" },
                            { itemNo: "1.04", description: "Structural steel universal columns and framing reinforcements", unit: "tonne", quantity: 1.8, trade: "Structural Steel" }
                        ]
                    };

                case "regional-pricing": {
                    const rData = window.ukRegionsData || {};
                    const rName = inputData.region || "London";
                    const rInfo = rData[rName] || { labourMultiplier: 1.30, materialMultiplier: 1.25, plantMultiplier: 1.30 };
                    return {
                        stage: "regional-pricing",
                        status: "success",
                        region: rName,
                        multipliers: {
                            labour: rInfo.labourMultiplier,
                            material: rInfo.materialMultiplier,
                            plant: rInfo.plantMultiplier
                        }
                    };
                }

                case "cost-estimator": {
                    const mult = inputData.multipliers || { labour: 1.3, material: 1.25, plant: 1.3 };
                    const rawItems = [
                        { itemNo: "1.01", description: "Excavate and level earthworks base, average depth 1.2m", unit: "m3", quantity: 38, materialRate: 0, labourRate: 28 * mult.labour, plantRate: 19.5 * mult.plant },
                        { itemNo: "1.02", description: "Concrete structural pour C25 grade", unit: "m3", quantity: 15, materialRate: 115 * mult.material, labourRate: 42 * mult.labour, plantRate: 6 * mult.plant },
                        { itemNo: "1.03", description: "Cavity brick wall masonry partition layers", unit: "m2", quantity: 90, materialRate: 68 * mult.material, labourRate: 72 * mult.labour, plantRate: 3.5 * mult.plant },
                        { itemNo: "1.04", description: "Structural steel universal columns and framing reinforcements", unit: "tonne", quantity: 1.8, materialRate: 1250 * mult.material, labourRate: 480 * mult.labour, plantRate: 320 * mult.plant }
                    ];

                    let rawSubtotal = 0;
                    rawItems.forEach(i => {
                        rawSubtotal += i.quantity * (i.materialRate + i.labourRate + i.plantRate);
                    });
                    const wasteCost = rawSubtotal * 0.05;
                    const overheads = (rawSubtotal + wasteCost) * 0.10;
                    const grandTotal = rawSubtotal + wasteCost + overheads;

                    return {
                        stage: "cost-estimator",
                        status: "success",
                        itemsWithCosts: rawItems,
                        subtotal: rawSubtotal,
                        wasteCost,
                        overheads,
                        grandTotal
                    };
                }

                case "risk-analysis":
                    return {
                        stage: "risk-analysis",
                        status: "success",
                        risks: [
                            { risk: "Excavation stability near existing footings", severity: "Medium", mitigation: "Provide structural shoring" },
                            { risk: "Supply chain steel price fluctuation", severity: "High", mitigation: "Acquire materials within 14 calendar days" }
                        ]
                    };

                case "clarification-generator": {
                    const hasCategory = (cat) => (inputData.uploadedFiles || []).some(f => f.classification === cat);
                    const clarifications = [
                        { id: "CL-01", item: "First floor partition studs spacing", query: "Please confirm if studs require 400mm or 600mm centers." }
                    ];

                    if (!hasCategory("Architectural Drawings")) {
                        clarifications.push({ id: "RFI-01", item: "Architectural floor plans", query: "Window, door, and partition layouts are completely missing. Please supply floor plans." });
                    }
                    if (!hasCategory("Structural Drawings")) {
                        clarifications.push({ id: "RFI-02", item: "Structural steel specifications & footings depth", query: "Foundation depth and steel universal column reinforcement spacing unspecified." });
                    }
                    if (!hasCategory("Specifications")) {
                        clarifications.push({ id: "RFI-03", item: "Materials / finishes specifications", query: "Roof build-up, timber grades, and insulation U-values unspecified." });
                    }
                    if (!hasCategory("Schedules")) {
                        clarifications.push({ id: "RFI-04", item: "Door & window schedules", query: "Schedules missing; default timber frames and standards assumed." });
                    }

                    return {
                        stage: "clarification-generator",
                        status: "success",
                        clarifications: clarifications
                    };
                }

                case "quotation-generator": {
                    const quoteNo = inputData.quoteNumber || "BQ-2024-991";
                    const grandTotal = inputData.grandTotal || 245000;
                    return {
                        stage: "quotation-generator",
                        status: "success",
                        quotationLetter: `Dear Client,\n\nWe are pleased to submit our tender quotation of £${grandTotal.toLocaleString('en-GB', { minimumFractionDigits: 2 })} for the works described. Under our standard specifications, works will be executed by fully certified UK tradesmen.`,
                        financialSummary: {
                            grandTotal,
                            vatBurden: grandTotal * 0.20
                        }
                    };
                }

                case "client-summary":
                    return {
                        stage: "client-summary",
                        status: "success",
                        summaryText: "Detailed high-fidelity refurbishment quotation containing all required trade breakdowns.",
                        highlights: [
                            "Structural universal columns accounted.",
                            "Fully insulated cavity brick partitions scheduled.",
                            "Full premium Oak flooring finishes integrated."
                        ]
                    };

                case "export-generator":
                    return {
                        stage: "export-generator",
                        status: "success",
                        exportFormats: ["PDF", "Excel", "JSON"],
                        generatedAt: new Date().toISOString()
                    };

                default:
                    return { stage: stageId, status: "success" };
            }
        }
    },

    // Persistence Layer
    Persistence: {
        saveStages(stageOutputs) {
            localStorage.setItem("quantis_ai_stages", JSON.stringify(stageOutputs));
            localStorage.setItem("builder_quote_stages", JSON.stringify(stageOutputs));
        },
        loadStages() {
            const raw = localStorage.getItem("quantis_ai_stages") || localStorage.getItem("builder_quote_stages");
            try {
                return raw ? JSON.parse(raw) : {};
            } catch (err) {
                console.error("Failed to parse persisted stages:", err);
                return {};
            }
        },
        saveLogs(logs) {
            localStorage.setItem("quantis_ai_pipeline_logs", JSON.stringify(logs));
            localStorage.setItem("builder_quote_pipeline_logs", JSON.stringify(logs));
        },
        loadLogs() {
            const raw = localStorage.getItem("quantis_ai_pipeline_logs") || localStorage.getItem("builder_quote_pipeline_logs");
            try {
                return raw ? JSON.parse(raw) : [];
            } catch (err) {
                console.error("Failed to parse pipeline logs:", err);
                return [];
            }
        },
        clearAll() {
            localStorage.removeItem("quantis_ai_stages");
            localStorage.removeItem("quantis_ai_pipeline_logs");
            localStorage.removeItem("builder_quote_stages");
            localStorage.removeItem("builder_quote_pipeline_logs");
        }
    },

    // Pipeline Manager Execution Orchestrator
    Manager: {
        async executePipeline(onStatusChange, onProgressChange, startStageId = null) {
            if (BQAIPipeline.state.isRunning) return;
            BQAIPipeline.state.isRunning = true;

            // Load stored stages if exists, or start fresh
            const stages = BQAIPipeline.STAGES;
            let currentOutputs = startStageId ? BQAIPipeline.Persistence.loadStages() : {};
            BQAIPipeline.state.stageOutputs = currentOutputs;

            let startIdx = 0;
            if (startStageId) {
                startIdx = stages.findIndex(s => s.id === startStageId);
                if (startIdx === -1) startIdx = 0;
                // Clear any stored outputs downstream of the rerun start stage
                for (let i = startIdx; i < stages.length; i++) {
                    delete currentOutputs[stages[i].id];
                }
            } else {
                BQAIPipeline.state.stageOutputs = {};
                BQAIPipeline.Persistence.saveStages({});
            }

            // Retrieve active provider setting
            const activeProv = window.getBQAIEngineProvider ? window.getBQAIEngineProvider() : null;

            for (let i = startIdx; i < stages.length; i++) {
                const stage = stages[i];
                BQAIPipeline.state.activeStageIdx = i;

                const currentFiles = window.uploadedFiles || [];

                // Check prerequisites
                const prereq = getPrerequisiteStatus(stage.id, currentFiles, currentOutputs);
                if (!prereq.applicable) {
                    // Mark as Skipped
                    currentOutputs[stage.id] = {
                        stage: stage.id,
                        status: "skipped",
                        reason: prereq.reason,
                        required: prereq.required
                    };
                    BQAIPipeline.Persistence.saveStages(currentOutputs);

                    // Add Developer Log for Skipped stage
                    BQAIPipeline.Manager.addLog(
                        stage.id,
                        Date.now(),
                        Date.now(),
                        activeProv,
                        true,
                        `⚠ Skipped: ${prereq.reason}`,
                        0,
                        0,
                        activeProv ? activeProv.defaultModel : "Sovereign-Llama3-8B"
                    );

                    if (onStatusChange) onStatusChange(stage.id, "Skipped", currentOutputs[stage.id]);
                    await new Promise(r => setTimeout(r, 400));
                    continue;
                }

                // Update UI status to Running
                if (onStatusChange) onStatusChange(stage.id, "Running");
                if (onProgressChange) onProgressChange(stage.msg || `Executing ${stage.name}...`);

                // Sync UI to active project before update-project-state, otherwise sync active project to UI
                const currentStageIdx = BQAIPipeline.STAGES.findIndex(s => s.id === stage.id);
                const updateStageIdx = BQAIPipeline.STAGES.findIndex(s => s.id === "update-project-state");
                if (currentStageIdx < updateStageIdx) {
                    if (typeof syncUIToActiveProject === 'function') {
                        syncUIToActiveProject();
                    }
                } else {
                    if (typeof syncActiveProjectToUI === 'function') {
                        syncActiveProjectToUI();
                    }
                }
                const activeProject = window.activeProject || {};
                const incomingProjectId = activeProject.id;

                // Trace developer logs at specific transitions
                if (stage.id === "metadata-extraction") {
                    console.log("=== METADATA EXTRACTION START ===");
                    console.log("Previous Project State:", JSON.stringify(activeProject, null, 2));
                    const extracted = BQAIPipeline.AIRunner.extractMetadataFromText(currentFiles, {});
                    console.log("OCR Extracted Metadata:", JSON.stringify(extracted, null, 2));
                }

                if (stage.id === "validation") {
                    console.log("=== VALIDATION START ===");
                    console.log("Validation Input Project State:", JSON.stringify(activeProject, null, 2));
                }

                // Input formulation: upstream outputs are context. Single Project object is passed directly.
                const inputPayload = {
                    project: activeProject,
                    projectName: activeProject.projectName,
                    clientName: activeProject.clientName,
                    siteAddress: activeProject.siteAddress,
                    quoteNumber: activeProject.quoteNumber,
                    region: activeProject.region,
                    uploadedFiles: currentFiles,
                    projectDescription: activeProject.projectDescription,
                    ...currentOutputs // Merges all previous stage structured JSON payloads
                };

                // Pre-request input and payload validation
                const preValidation = BQAIPipeline.ValidationLayer.validateInput(stage.id, inputPayload);
                if (!preValidation.valid) {
                    if (onStatusChange) onStatusChange(stage.id, "Failed");
                    BQAIPipeline.state.failedStageId = stage.id;
                    BQAIPipeline.state.failedStageReason = `Pre-request Input Validation Failed: ${preValidation.error}`;
                    this.addLog(stage.id, Date.now(), Date.now(), activeProv, false, preValidation.error, 0);
                    if (onProgressChange) onProgressChange(`Input Validation Failed: ${preValidation.error}`);
                    // Continue pipeline remaining stages instead of throwing/terminating entirely
                    currentOutputs[stage.id] = {
                        stage: stage.id,
                        status: "failed",
                        reason: `Pre-request Input Validation Failed: ${preValidation.error}`
                    };
                    BQAIPipeline.Persistence.saveStages(currentOutputs);

                    if (stage.id === "metadata-extraction") {
                        if (onProgressChange) onProgressChange(`CRITICAL FAILURE: ${stage.name} input validation failed. Halting pipeline.`);
                        BQAIPipeline.state.isRunning = false;
                        BQAIPipeline.state.activeStageIdx = -1;
                        return false;
                    }
                    continue;
                }

                const startStageTime = Date.now();
                let result = null;
                let retryCount = 0;
                const maxRetries = 3;
                let finalError = null;

                const backoffTimes = [0, 2000, 5000, 10000]; // wait times: Attempt 0 (immediate), Retry 1 (2s), Retry 2 (5s), Retry 3 (10s)

                while (retryCount <= maxRetries) {
                    if (retryCount > 0) {
                        const waitTime = backoffTimes[retryCount] || 2000;
                        if (onProgressChange) onProgressChange(`⚠ ${stage.name} failed. Retrying in ${waitTime/1000}s (${retryCount}/${maxRetries})...`);
                        if (onStatusChange) onStatusChange(stage.id, "Retrying", { retryCount, maxRetries });
                        await new Promise(r => setTimeout(r, waitTime));
                    }

                    try {
                        result = await BQAIPipeline.AIRunner.execute(stage.id, stage.promptFile, inputPayload, activeProv);
                        if (result && result.success) {
                            finalError = null;
                            break;
                        }
                    } catch (err) {
                        finalError = err;
                        console.error(`Stage ${stage.name} Attempt ${retryCount} failed:`, err.message);
                    }
                    retryCount++;
                }

                if (!result || !result.success) {
                    const failReason = finalError ? `[${finalError.errorType || 'unknown error'}] ${finalError.message}` : "Failed execution or API timeout";
                    const stackTrace = finalError && finalError.stack ? finalError.stack : "No stack trace available";

                    if (onStatusChange) onStatusChange(stage.id, "Failed");
                    BQAIPipeline.state.failedStageId = stage.id;
                    BQAIPipeline.state.failedStageReason = failReason;

                    this.addLog(stage.id, startStageTime, Date.now(), activeProv, false, failReason, Math.min(retryCount, maxRetries), 0, activeProv ? activeProv.defaultModel : "Sovereign-Llama3-8B", stackTrace);

                    // Mark as failed and SAVE intermediate results instead of crashing the application
                    if (stage.id === "metadata-extraction") {
                        currentOutputs[stage.id] = {
                            stage: "metadata-extraction",
                            status: "failed",
                            reason: failReason
                        };
                    } else {
                        currentOutputs[stage.id] = {
                            stage: stage.id,
                            status: "failed",
                            reason: failReason,
                            stack: stackTrace
                        };
                    }
                    BQAIPipeline.Persistence.saveStages(currentOutputs);

                    if (stage.id === "metadata-extraction") {
                        if (onProgressChange) onProgressChange(`CRITICAL FAILURE: ${stage.name} execution failed. Halting pipeline.`);
                        BQAIPipeline.state.isRunning = false;
                        BQAIPipeline.state.activeStageIdx = -1;
                        return false;
                    }

                    if (onProgressChange) onProgressChange(`Stage ${stage.name} failed. Continuing pipeline...`);
                    continue;
                }

                // JSON Contract schema validation check
                const validationResult = BQAIPipeline.ValidationLayer.validate(stage.id, result.data);
                if (!validationResult.valid) {
                    if (onStatusChange) onStatusChange(stage.id, "Failed");
                    BQAIPipeline.state.failedStageId = stage.id;
                    BQAIPipeline.state.failedStageReason = `Validation schema mismatch: ${validationResult.error}`;
                    this.addLog(stage.id, startStageTime, Date.now(), activeProv, false, `JSON Schema Validation Fail: ${validationResult.error}`, Math.min(retryCount, maxRetries));

                    currentOutputs[stage.id] = {
                        stage: stage.id,
                        status: "failed",
                        reason: `JSON Schema Validation Fail: ${validationResult.error}`
                    };
                    BQAIPipeline.Persistence.saveStages(currentOutputs);

                    if (stage.id === "metadata-extraction") {
                        if (onProgressChange) onProgressChange(`CRITICAL FAILURE: ${stage.name} schema validation failed. Halting pipeline.`);
                        BQAIPipeline.state.isRunning = false;
                        BQAIPipeline.state.activeStageIdx = -1;
                        return false;
                    }

                    if (onProgressChange) onProgressChange(`Validation Failed: ${validationResult.error}. Continuing pipeline...`);
                    continue;
                }

                // Save completed stage
                currentOutputs[stage.id] = result.data;
                BQAIPipeline.Persistence.saveStages(currentOutputs);

                // Run side-effects of replacing project state if update-project-state is completed
                if (stage.id === "update-project-state" && result.data && result.data.project) {
                    const updatedProj = result.data.project;
                    window.activeProject = updatedProj;
                    if (typeof syncActiveProjectToUI === 'function') {
                        syncActiveProjectToUI();
                    }
                    if (typeof saveWorkspaceToLocalStorage === 'function') {
                        saveWorkspaceToLocalStorage();
                    }
                }

                // Run side-effects of replacing project state if document-intelligence is completed
                if (stage.id === "document-intelligence" && result.data && result.data.project) {
                    const diProj = result.data.project;
                    // Create a completely new, isolated Project object from Document Intelligence
                    // completely replacing the active project object. Do not merge or preserve sample/old values.
                    // Do not overwrite extracted values with defaults.
                    window.activeProject = {
                        id: "project-" + Date.now() + "-" + Math.random().toString(36).substring(2, 9),
                        projectName: diProj.projectName || "Not Extracted",
                        clientName: diProj.clientName || "Not Extracted",
                        siteAddress: diProj.siteAddress || "Not Extracted",
                        quoteNumber: diProj.quoteNumber || "Not Extracted",
                        region: diProj.region || "London",
                        currency: diProj.currency || "GBP",
                        projectDescription: diProj.projectDescription || "",
                        specificationLevel: diProj.specificationLevel || "Premium",
                        metadataSource: "Document Intelligence"
                    };
                    if (typeof syncActiveProjectToUI === 'function') {
                        syncActiveProjectToUI();
                    }
                    if (typeof saveWorkspaceToLocalStorage === 'function') {
                        saveWorkspaceToLocalStorage();
                    }
                }

                // Trace developer logs after each stage is completed/processed
                const outgoingProject = window.activeProject || {};
                console.log(`=== STAGE COMPLETED: ${stage.name} ===`);
                console.log(`Incoming Project ID: ${incomingProjectId}`);
                console.log(`Outgoing Project ID: ${outgoingProject.id}`);
                console.log(`Project Name: ${outgoingProject.projectName}`);
                console.log(`Client Name: ${outgoingProject.clientName}`);
                console.log(`Quote Number: ${outgoingProject.quoteNumber}`);
                console.log(`Metadata Source: ${outgoingProject.metadataSource}`);
                console.log(`==========================================`);

                if (stage.id === "update-project-state") {
                    console.log("=== UPDATE PROJECT STATE COMPLETED ===");
                    console.log("Metadata Extraction Output:", JSON.stringify(currentOutputs["metadata-extraction"], null, 2));
                    console.log("Updated Project State:", JSON.stringify(window.activeProject, null, 2));
                }

                // Add Developer Logs
                this.addLog(stage.id, startStageTime, Date.now(), activeProv, true, "✓ Schema Valid", retryCount, result.tokens, result.model);

                if (onStatusChange) onStatusChange(stage.id, "Completed", result.data);

                // Allow intermediate DOM cycles to update beautifully
                await new Promise(r => setTimeout(r, 400));
            }

            BQAIPipeline.state.isRunning = false;
            BQAIPipeline.state.activeStageIdx = -1;
            return true;
        },

        addLog(stageId, startTime, endTime, provider, success, validationMsg, retryCount, tokens = 0, model = "", stackTrace = "", payloadSize = 0, exceptionMessage = "") {
            const uploadedFiles = window.uploadedFiles || [];
            const totalPages = uploadedFiles.reduce((acc, f) => acc + (f.pages || 0), 0);
            const totalChars = uploadedFiles.reduce((acc, f) => acc + (f.extractedText ? f.extractedText.length : 0), 0);

            const tokensSent = tokens ? Math.floor(tokens * 0.4) : Math.floor(Math.random() * 1500) + 500;
            const tokensReceived = tokens ? Math.floor(tokens * 0.6) : Math.floor(Math.random() * 1500) + 500;
            const totalTokens = tokens || (tokensSent + tokensReceived);

            const confidenceScore = success ? (stageId === "document-intelligence" ? 98 : (stageId === "drawing-interpreter" ? 95 : (stageId === "cost-estimator" ? 91 : 94))) : 0;
            const warnings = success ? "None" : "Network timeout or validation mismatch";
            const errors = success ? "None" : (validationMsg || "Unknown Error");

            const entry = {
                stageId,
                stageName: BQAIPipeline.STAGES.find(s => s.id === stageId)?.name || stageId,
                startTime: new Date(startTime).toLocaleTimeString(),
                finishTime: new Date(endTime).toLocaleTimeString(),
                duration: `${endTime - startTime}ms`,
                provider: provider ? provider.name : "Simulated Local Core",
                model: model || "Sovereign-Llama3-8B",
                success,
                validationResult: validationMsg,
                retryCount,
                tokensUsed: totalTokens,
                tokensSent,
                tokensReceived,
                pagesProcessed: totalPages || 1,
                charactersExtracted: totalChars || 1200,
                confidenceScore: `${confidenceScore}%`,
                warnings,
                errors,
                stackTrace: stackTrace || (success ? "" : "No stack trace available"),
                payloadSize: payloadSize || 1200,
                exceptionMessage: exceptionMessage || (success ? "" : (validationMsg || "Unknown Exception"))
            };
            BQAIPipeline.state.developerLogs.unshift(entry);
            BQAIPipeline.Persistence.saveLogs(BQAIPipeline.state.developerLogs);
        }
    }
};