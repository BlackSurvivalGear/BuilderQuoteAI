/**
 * BuilderQuoteAI - Phase 2 AI Orchestration Engine (pipeline.js)
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
    // 12 official stages in correct sequence
    STAGES: [
        { id: "upload-documents", name: "Upload Documents", promptFile: null, msg: "Reading construction drawings..." },
        { id: "document-intelligence", name: "Document Intelligence", promptFile: "document-intelligence.md", msg: "Analysing project documents..." },
        { id: "drawing-interpreter", name: "Drawing Interpreter", promptFile: "drawing-interpreter.md", msg: "Identifying structural elements & rooms..." },
        { id: "quantity-surveyor", name: "Quantity Surveyor", promptFile: "quantity-surveyor.md", msg: "Measuring construction quantities..." },
        { id: "boq-generator", name: "BOQ Generator", promptFile: "boq-generator.md", msg: "Generating Bill of Quantities..." },
        { id: "regional-pricing", name: "Regional Pricing", promptFile: "regional-pricing.md", msg: "Applying regional pricing..." },
        { id: "cost-estimator", name: "Cost Estimator", promptFile: "cost-estimator.md", msg: "Calculating labor & materials..." },
        { id: "risk-analysis", name: "Risk Analysis", promptFile: "risk-analysis.md", msg: "Analysing commercial risks..." },
        { id: "clarification-generator", name: "Clarification Generator", promptFile: "clarification-generator.md", msg: "Identifying design clarifications..." },
        { id: "quotation-generator", name: "Quotation Generator", promptFile: "quotation-generator.md", msg: "Generating professional quotation..." },
        { id: "client-summary", name: "Client Summary", promptFile: "client-summary.md", msg: "Preparing client summary..." },
        { id: "export-generator", name: "Export Generator", promptFile: "export-generator.md", msg: "Preparing exports..." }
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

        validate(stageId, data) {
            if (data && data.status === "skipped") {
                return { valid: true, error: null };
            }

            const schema = this.schemas[stageId];
            if (!schema) {
                return { valid: true, error: null };
            }

            if (typeof data !== "object" || data === null) {
                return { valid: false, error: "Output is not a valid JSON object" };
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

                let endpoint = "";
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
                    body: requestBodyStr
                });

                console.log("=================== LIVE AI RESPONSE RECEIVED ===================");
                console.log(`HTTP Status Code: ${res.status} ${res.statusText || ""}`);

                if (!res.ok) {
                    const errorText = await res.text();
                    console.error(`HTTP Error Response Body:`, errorText);
                    console.log("==================================================================");
                    throw new Error(`Handshake failed: HTTP status ${res.status}. Response: ${errorText}`);
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

                const cleanedJSON = this.cleanJSONResponse(rawText);
                const parsed = JSON.parse(cleanedJSON);
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
                console.error("=================== LIVE AI REQUEST FAILED ===================");
                console.error(`Error during execute for stage "${stageId}":`, err.message);
                console.error(err);
                console.error("==============================================================");

                // Update Debug Console on Failure
                if (typeof updateAIDebugConsole === 'function') {
                    updateAIDebugConsole({
                        endpoint: endpoint || "Failed API Endpoint",
                        httpStatus: "Failed (No Fallback in Production Mode)",
                        tokens: "0 tok",
                        executionTime: `${Date.now() - startTime} ms`,
                        rawResponse: `API Error: ${err.message}`,
                        parsedJson: "None - Request Failed",
                        errors: `API Error: ${err.message}`
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

                case "document-intelligence":
                    return {
                        stage: "document-intelligence",
                        status: "success",
                        confidence: 0.98,
                        project: {
                            projectName: inputData.projectName || "Unknown",
                            clientName: inputData.clientName || "Not Supplied",
                            siteAddress: inputData.siteAddress || "Awaiting Information",
                            quoteNumber: inputData.quoteNumber || "Awaiting Information"
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

                case "regional-pricing":
                    return {
                        stage: "regional-pricing",
                        status: "success",
                        region: inputData.region || "London",
                        multipliers: {
                            labour: 1.30,
                            material: 1.25,
                            plant: 1.30
                        }
                    };

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
            localStorage.setItem("builder_quote_stages", JSON.stringify(stageOutputs));
        },
        loadStages() {
            const raw = localStorage.getItem("builder_quote_stages");
            try {
                return raw ? JSON.parse(raw) : {};
            } catch (err) {
                console.error("Failed to parse persisted stages:", err);
                return {};
            }
        },
        saveLogs(logs) {
            localStorage.setItem("builder_quote_pipeline_logs", JSON.stringify(logs));
        },
        loadLogs() {
            const raw = localStorage.getItem("builder_quote_pipeline_logs");
            try {
                return raw ? JSON.parse(raw) : [];
            } catch (err) {
                console.error("Failed to parse pipeline logs:", err);
                return [];
            }
        },
        clearAll() {
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

                // Input formulation: upstream outputs are context
                const inputPayload = {
                    projectName: document.getElementById('project-name')?.value || "Unknown",
                    clientName: document.getElementById('project-client')?.value || "Not Supplied",
                    siteAddress: document.getElementById('project-site')?.value || "Awaiting Information",
                    quoteNumber: document.getElementById('project-quote-no')?.value || "Awaiting Information",
                    region: document.getElementById('project-region')?.value || "London",
                    uploadedFiles: currentFiles,
                    projectDescription: document.getElementById('workspace-project-description')?.value || "",
                    ...currentOutputs // Merges all previous stage structured JSON payloads
                };

                const startStageTime = Date.now();
                let result = null;
                let retryCount = 0;
                const maxRetries = 1;

                while (retryCount <= maxRetries) {
                    try {
                        result = await BQAIPipeline.AIRunner.execute(stage.id, stage.promptFile, inputPayload, activeProv);
                        if (result.success) break;
                    } catch (err) {
                        console.error(`Stage ${stage.name} Attempt ${retryCount + 1} failed:`, err);
                    }
                    retryCount++;
                }

                if (!result || !result.success) {
                    // Stage failure
                    if (onStatusChange) onStatusChange(stage.id, "Failed");
                    BQAIPipeline.state.isRunning = false;
                    this.addLog(stage.id, startStageTime, Date.now(), activeProv, false, "Failed execution or API timeout", retryCount);
                    return false;
                }

                // JSON Contract schema validation check
                const validationResult = BQAIPipeline.ValidationLayer.validate(stage.id, result.data);
                if (!validationResult.valid) {
                    if (onStatusChange) onStatusChange(stage.id, "Failed");
                    BQAIPipeline.state.isRunning = false;
                    this.addLog(stage.id, startStageTime, Date.now(), activeProv, false, `JSON Schema Validation Fail: ${validationResult.error}`, retryCount);
                    if (onProgressChange) onProgressChange(`Validation Failed: ${validationResult.error}. Allow retry.`);
                    return false;
                }

                // Save completed stage
                currentOutputs[stage.id] = result.data;
                BQAIPipeline.Persistence.saveStages(currentOutputs);

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

        addLog(stageId, startTime, endTime, provider, success, validationMsg, retryCount, tokens = 0, model = "") {
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
                tokensUsed: tokens || Math.floor(Math.random() * 100) + 120
            };
            BQAIPipeline.state.developerLogs.unshift(entry);
            BQAIPipeline.Persistence.saveLogs(BQAIPipeline.state.developerLogs);
        }
    }
};