async function recognize(base64, lang, options) {
    const { config, utils } = options;
    const { tauriFetch } = utils;
    let { apikey, engine } = config;
    base64 = `data:image/png;base64,${base64}`;

    if (apikey === undefined || apikey.length === 0) {
        throw "apikey not found";
    }
    if (engine === undefined || engine.length === 0) {
        engine = "1";
    }

    let res = await tauriFetch('https://api.ocr.space/parse/image', {
        method: "POST",
        header: {
            apikey,
            "content-type": "application/x-www-form-urlencoded"
        },
        body: {
            type: "Form",
            payload: {
                base64Image: base64,
                OCREngine: engine,
                language: lang
            }
        }
    })

    if (res.ok) {
        const { result } = res.data;
        const { ErrorMessage, ParsedResults } = result;
        if (ErrorMessage) {
            throw ErrorMessage;
        }
        if (ParsedResults) {
            let target = "";
            for (let i in ParsedResults) {
                const { ParsedText } = i;
                target += ParsedText;
            }
            return target;
        } else {
            throw JSON.stringify(result);
        }
    } else {
        throw JSON.stringify(res);
    }
}