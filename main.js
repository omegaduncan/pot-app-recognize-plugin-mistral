async function recognize(base64, lang, options) {
    const { config: pluginConfig, utils } = options;
    const { tauriFetch } = utils;

    // 檢查並設定 enableLLM 的預設值
    console.debug("原始 enableLLM:", pluginConfig.enableLLM);
    if (typeof pluginConfig.enableLLM === "undefined" || pluginConfig.enableLLM === null || pluginConfig.enableLLM === "") {
        pluginConfig.enableLLM = "false"; // 預設關閉文字後處理功能
    }
    console.debug("修改後 enableLLM:", pluginConfig.enableLLM);

    const { apiKey, llmModel, requestPath, customPrompt, llmApiKey } = pluginConfig;
    
    // 檢查 API Key 是否存在
    if (!apiKey || apiKey.length === 0) {
        throw "API Key not found";
    }

    // 設置請求頭
    const headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
    };

    // 設置 OCR 請求體
    const ocrBody = {
        "model": "mistral-ocr-latest",
        "document": {
            "type": "image_url",
            "image_url": `data:image/png;base64,${base64}`
        }
    };

    try {
        // 發送 OCR 請求
        let res = await tauriFetch("https://api.mistral.ai/v1/ocr", {
            method: "POST",
            url: "https://api.mistral.ai/v1/ocr",
            headers: headers,
            body: {
                type: "Json",
                payload: ocrBody
            },
            responseType: 1
        });

        // 處理 OCR 響應
        if (res.ok) {
            let result = res.data;
            
            // 檢查返回格式並提供詳細錯誤信息
            if (!result) {
                throw "Empty response from Mistral API";
            }
            
            if (!result.pages || !Array.isArray(result.pages) || result.pages.length === 0) {
                throw `No pages in response: ${JSON.stringify(result)}`;
            }
            
            // 從所有頁面提取文本內容並合併
            let textContent = "";
            for (let i = 0; i < result.pages.length; i++) {
                const page = result.pages[i];
                if (page.markdown) {
                    // 如果已有內容，添加分頁符
                    if (textContent.length > 0) {
                        textContent += "\n\n";
                    }
                    // 添加頁面 markdown 內容
                    textContent += page.markdown;
                }
            }
            
            if (textContent.length === 0) {
                throw "No text content found in OCR results";
            }
            
            // 如果啟用了 LLM 處理，將 OCR 結果發送給 LLM 進行處理
            if (pluginConfig.enableLLM === "true") {
                try {
                    console.log(`[DEBUG] 啟用後處理，使用模型: ${llmModel || "gpt-4o"}`);
                    const llmResult = await processWithLLM(textContent, lang, {
                        apiKey: llmApiKey || apiKey,
                        model: llmModel || "gpt-4o",
                        requestPath: requestPath || "https://api.openai.com/v1/chat/completions",
                        customPrompt: customPrompt || "Just recognize the text in the image. Do not offer unnecessary explanations.",
                        tauriFetch
                    });
                    
                    if (llmResult && !llmResult.error) {
                        console.debug("LLM 處理後的結果:", llmResult);
                        return llmResult;
                    } else {
                        console.error("LLM 處理失敗:", llmResult?.error || "未知錯誤");
                        return textContent;
                    }
                } catch (err) {
                    console.error("LLM 處理異常:", err);
                    return textContent;
                }
            } else {
                console.log(`[DEBUG] 後處理未啟用，直接返回OCR結果`);
            }
            
            // 如果未啟用 LLM 處理，直接返回 OCR 結果
            return textContent;
        } else {
            throw `Request failed with status ${res.status}: ${JSON.stringify(res.data)}`;
        }
    } catch (error) {
        // 處理其他可能的錯誤
        if (typeof error === 'string') {
            throw error;
        } else {
            throw `Error occurred: ${error.message || JSON.stringify(error)}`;
        }
    }
}

// 使用 LLM 處理 OCR 文本
async function processWithLLM(text, lang, options) {
    // 解構參數，移除 provider
    const { apiKey, model, requestPath, customPrompt, tauriFetch } = options;
    
    // 檢查是否有 API Key
    if (!apiKey) {
        console.error("未提供 LLM API Key");
        return { error: "未提供 LLM API Key" };
    }
    
    // 自動識別 LLM 提供者類型
    const isGeminiModel = model?.toLowerCase().includes("gemini");
    const isMistralModel = model?.toLowerCase().includes("mistral");
    
    // 處理請求路徑，自動補全完整地址
    let actualRequestPath = requestPath;

    // 檢查是否為 Google API
    const isGoogleAPI = actualRequestPath?.includes('generativelanguage.googleapis.com');
    const isOpenAIAPI = actualRequestPath?.includes('api.openai.com');
    const isMistralAPI = actualRequestPath?.includes('api.mistral.ai');

    // 自動補全 API 路徑
    if (isGeminiModel) {
        // Gemini 模型處理
        let geminiModel = model;
        
        // 如果用戶未提供路徑，或提供的是 OpenAI/Mistral 路徑但模型是 Gemini，使用 Google API
        if (!actualRequestPath || isOpenAIAPI || isMistralAPI) {
            actualRequestPath = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`;
            console.log(`[DEBUG] 檢測到 Gemini 模型，自動切換到 Google API 端點`);
        } else {
            console.log(`[DEBUG] 使用用戶提供的自訂端點: ${actualRequestPath}`);
        }
    } else if (isMistralModel || (requestPath && requestPath.includes("mistral"))) {
        // Mistral AI
        if (actualRequestPath) {
            // 檢查是否有 HTTP 協議前綴
            if (!/^https?:\/\//i.test(actualRequestPath)) {
                actualRequestPath = `https://${actualRequestPath}`;
            }
            
            // 移除尾部斜線
            actualRequestPath = actualRequestPath.replace(/\/+$/, "");
            
            // 檢查是否需要補全路徑
            if (!actualRequestPath.includes("/v1/chat/completions")) {
                if (actualRequestPath.includes("/v1")) {
                    actualRequestPath = `${actualRequestPath}/chat/completions`;
                } else {
                    actualRequestPath = `${actualRequestPath}/v1/chat/completions`;
                }
            }
        } else {
            // 預設 Mistral API 地址
            actualRequestPath = "https://api.mistral.ai/v1/chat/completions";
        }
    } else {
        // 其他 API (OpenAI 或相容 OpenAI API 的第三方服務)
        if (actualRequestPath) {
            // 檢查是否有 HTTP 協議前綴
            if (!/^https?:\/\//i.test(actualRequestPath)) {
                actualRequestPath = `https://${actualRequestPath}`;
            }
            
            // 移除尾部斜線
            actualRequestPath = actualRequestPath.replace(/\/+$/, "");
            
            // 檢查是否需要補全路徑
            if (!actualRequestPath.includes("/v1/chat/completions")) {
                if (actualRequestPath.includes("/v1")) {
                    actualRequestPath = `${actualRequestPath}/chat/completions`;
                } else {
                    actualRequestPath = `${actualRequestPath}/v1/chat/completions`;
                }
            }
        } else {
            // 預設 OpenAI API 地址
            actualRequestPath = "https://api.openai.com/v1/chat/completions";
        }
    }

    console.log(`[DEBUG] 使用模型: ${model}, API 路徑: ${actualRequestPath}`);
    
    // 根據語言調整 prompt
    let finalPrompt = customPrompt;
    if (finalPrompt.includes("$lang")) {
        finalPrompt = finalPrompt.replaceAll("$lang", lang);
    }
    
    // 設置請求頭
    const headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
    };

    // 特殊處理 Google API 的授權
    if (isGeminiModel && (actualRequestPath.includes('googleapis.com'))) {
        // Google API 使用 URL 參數的 API key
        actualRequestPath = actualRequestPath.includes('?') 
            ? `${actualRequestPath}&key=${apiKey}` 
            : `${actualRequestPath}?key=${apiKey}`;
        
        // 移除 Authorization 頭，Google API 不使用它
        headers.Authorization = undefined;
        console.log(`[DEBUG] 使用 Google API 授權方式`);
    }
    
    // 依據 API 地址設置請求體
    let body = {};

    if (isGeminiModel || isGoogleAPI) {
        // Google Gemini API 格式
        let geminiModel = model;
        if (!geminiModel || geminiModel === "gpt-4o") {
            geminiModel = "gemini-1.5-flash";
        }
        
        if (actualRequestPath.includes('googleapis.com')) {
            // 原生 Google Gemini API 格式
            body = {
                contents: [{
                    role: "user",
                    parts: [
                        {
                            text: `${finalPrompt}\n\n${text}`
                        }
                    ]
                }]
            };
        } else {
            // 第三方 API，使用 OpenAI 格式但保留 gemini 模型名稱
            body = {
                "model": geminiModel,
                "messages": [
                    {
                        "role": "user",
                        "content": `${finalPrompt}\n\n${text}`
                    }
                ],
                "temperature": 0.3
            };
        }
    } else {
        // OpenAI 或 Mistral API 格式 (兩者格式相同)
        body = {
            "model": model || "gpt-4o",
            "messages": [
                {
                    "role": "user",
                    "content": `${finalPrompt}\n\n${text}`
                }
            ],
            "temperature": 0.3
        };
    }
    
    console.log(`[DEBUG] 請求體結構: ${JSON.stringify({...body, messages: body.messages ? "[...]" : undefined, contents: body.contents ? "[...]" : undefined})}`);
    
    // 發送請求並處理響應
    try {
        console.log(`[DEBUG] 發送 ${isGeminiModel ? 'Gemini' : (isMistralModel ? 'Mistral' : 'OpenAI')} 請求到: ${actualRequestPath}`);
        console.log(`[DEBUG] 請求體: ${JSON.stringify(body)}`);
        
        let res = await tauriFetch(actualRequestPath, {
            method: "POST",
            url: actualRequestPath,
            headers: headers,
            body: {
                type: "Json",
                payload: body
            },
            responseType: 1
        });
        
        console.log(`[DEBUG] 響應狀態: ${res.status}, 響應數據: ${JSON.stringify(res.data)}`);
        
        // 檢查響應
        if (!res.ok) {
            throw `API request failed: ${res.status} - ${JSON.stringify(res.data)}`;
        }
        
        let result = res.data;
        if (!result) {
            throw "Empty response from API";
        }
        
        // 根據請求路徑和響應格式處理不同 API 的響應
        if (actualRequestPath.includes('googleapis.com')) {
            // 處理 Google API 的返回格式
            if (!result.candidates || !result.candidates[0]) {
                throw `Invalid Gemini API Response: ${JSON.stringify(result)}`;
            }
            
            return result.candidates[0].content.parts[0].text;
        } else {
            // 處理 OpenAI/Mistral API 格式的響應 (也包括第三方 API)
            if (result.choices && result.choices[0] && result.choices[0].message) {
                // OpenAI 格式
                return result.choices[0].message.content;
            } else if (result.candidates && result.candidates[0]) {
                // 某些第三方可能用 Gemini 風格返回
                return result.candidates[0].content.parts[0].text;
            } else if (result.content) {
                // 簡化的返回格式
                return result.content;
            } else {
                // 未識別格式，嘗試提取可能的內容
                console.warn(`[WARN] 未識別的 API 響應格式: ${JSON.stringify(result)}`);
                
                // 嘗試各種可能的路徑
                if (result.message && result.message.content) {
                    return result.message.content;
                } else if (result.text || result.data) {
                    return result.text || result.data;
                } else {
                    throw `無法從響應中提取文本: ${JSON.stringify(result)}`;
                }
            }
        }
    } catch (error) {
        console.error("[DEBUG] LLM處理錯誤:", error);
        // 如果 LLM 處理失敗，返回原始 OCR 文本並附加錯誤信息
        return `[LLM處理失敗，顯示原始OCR結果] 錯誤: ${typeof error === 'string' ? error : error.message || JSON.stringify(error)}\n\n${text}`;
    }
}