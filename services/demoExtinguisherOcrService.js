const sharp = require('sharp');

// Default supports current format like SPF-6KG and future variable lengths.
const DEFAULT_CODE_REGEX = '^[A-Z0-9]{2,10}-[A-Z0-9]{1,10}$';
const DEFAULT_MIN_CONFIDENCE = 0.45;

function normalizeCode(rawCode) {
  if (!rawCode || typeof rawCode !== 'string') {
    return '';
  }

  return rawCode
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9-]/g, '');
}

function getValidationConfig() {
  const regexSource = process.env.DEMO_EXT_CODE_REGEX || DEFAULT_CODE_REGEX;
  const minConfidence = Number(process.env.DEMO_EXT_MIN_CONFIDENCE || DEFAULT_MIN_CONFIDENCE);
  return {
    codeRegex: new RegExp(regexSource),
    minConfidence: Number.isFinite(minConfidence) ? minConfidence : DEFAULT_MIN_CONFIDENCE
  };
}

function stripAnchors(regexSource) {
  return regexSource.replace(/^\^/, '').replace(/\$$/, '');
}

function normalizeFieldKey(field) {
  return String(field || '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeExtractorType(extractor) {
  const normalized = String(extractor || '').toLowerCase().trim();
  if (normalized === 'code' || normalized === 'decimal_number' || normalized === 'alphanumeric' || normalized === 'text') {
    return normalized;
  }
  return 'code';
}

function sanitizeExtractFields(extractFields) {
  if (!Array.isArray(extractFields)) {
    return [];
  }

  const deduped = new Map();
  for (const field of extractFields) {
    const rawName = typeof field === 'string' ? field : field && field.name;
    const name = normalizeFieldKey(rawName);
    if (!name) {
      continue;
    }

    const normalizedConfig = {
      name,
      extractor: normalizeExtractorType(field && typeof field === 'object' ? field.extractor : 'code'),
      required: field && typeof field === 'object' && field.required === false ? false : true
    };

    if (!deduped.has(name)) {
      deduped.set(name, normalizedConfig);
    } else {
      const previous = deduped.get(name);
      deduped.set(name, {
        ...previous,
        required: previous.required || normalizedConfig.required
      });
    }
  }

  return Array.from(deduped.values());
}

function resolvePrimaryRequestedField(requestedFieldConfigs, extractedFields) {
  if (!Array.isArray(requestedFieldConfigs) || requestedFieldConfigs.length === 0) {
    return null;
  }

  const requiredWithValue = requestedFieldConfigs.find((cfg) => cfg.required && extractedFields[cfg.name]);
  if (requiredWithValue) {
    return requiredWithValue.name;
  }

  const anyWithValue = requestedFieldConfigs.find((cfg) => extractedFields[cfg.name]);
  return anyWithValue ? anyWithValue.name : null;
}

function extractCandidateFromAnchorTail(tailText, extractor) {
  const tailUpper = String(tailText || '').toUpperCase();
  if (!tailUpper.trim()) {
    return '';
  }

  // Cut off when nearby fields start to reduce noisy concatenation.
  const trimmedTail = tailUpper.split(
    /(FULL\s*WT|SR\s*NO|BATCH\s*NO|MONTH|YEAR|MFG|MANUFACTURED|TARE|R\.)/
  )[0];

  if (extractor === 'decimal_number') {
    const decimalMatch = trimmedTail.match(/\d+(?:[.,]\d+)?/);
    if (decimalMatch && decimalMatch[0]) {
      return decimalMatch[0].replace(',', '.');
    }
    return '';
  }

  if (extractor === 'text') {
    const textMatch = trimmedTail.match(/[A-Z0-9][A-Z0-9\s\-./]{1,30}/);
    if (textMatch && textMatch[0]) {
      return textMatch[0].trim().replace(/\s+/g, ' ');
    }
    return '';
  }

  const hyphenCodeMatch = trimmedTail.match(/[A-Z0-9]{2,10}\s*-\s*[A-Z0-9]{1,10}/);
  if (hyphenCodeMatch && hyphenCodeMatch[0]) {
    return extractor === 'alphanumeric'
      ? hyphenCodeMatch[0].replace(/[^A-Z0-9]/g, '')
      : normalizeCode(hyphenCodeMatch[0]);
  }

  const fallbackTokenMatch = trimmedTail.match(/[A-Z0-9\-]{3,20}/);
  if (fallbackTokenMatch && fallbackTokenMatch[0]) {
    return extractor === 'alphanumeric'
      ? fallbackTokenMatch[0].replace(/[^A-Z0-9]/g, '')
      : normalizeCode(fallbackTokenMatch[0]);
  }

  return '';
}

function buildFieldAnchorRegex(fieldName) {
  const normalizedField = normalizeFieldKey(fieldName);
  if (!normalizedField) {
    return null;
  }

  const tokens = normalizedField.split(' ').filter(Boolean);
  if (tokens.length === 0) {
    return null;
  }

  const escapedTokens = tokens.map((token) => {
    if (token === 'NO') {
      return 'N[O0]';
    }
    return token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  });

  return new RegExp(`${escapedTokens.join('\\s*')}[\\s:.\\-]*`);
}

function findModelNoAnchorMatch(inputText) {
  const upperText = String(inputText || '').toUpperCase();
  const anchors = [
    /MODEL\s*NO[\s:.\-]*/,
    /MODELNO[\s:.\-]*/,
    /MODEL\s*N0[\s:.\-]*/ // OCR sometimes confuses O with zero
  ];

  for (const anchorRegex of anchors) {
    const match = upperText.match(anchorRegex);
    if (match) {
      return {
        anchorMatch: match,
        upperText
      };
    }
  }

  return null;
}

function findFieldAnchorMatch(inputText, fieldName) {
  const upperText = String(inputText || '').toUpperCase();
  const anchorRegex = buildFieldAnchorRegex(fieldName);
  if (!anchorRegex) {
    return null;
  }
  const match = upperText.match(anchorRegex);
  if (!match) {
    return null;
  }
  return {
    anchorMatch: match,
    upperText
  };
}

function parseModelNoCandidate(rawText) {
  const upperText = String(rawText || '').toUpperCase();
  if (!upperText.trim()) {
    return { candidate: '', parseReason: 'empty_ocr_text' };
  }

  const anchorData = findModelNoAnchorMatch(upperText);
  if (!anchorData) {
    return { candidate: '', parseReason: 'model_no_anchor_not_found' };
  }

  const { anchorMatch } = anchorData;
  const startIndex = (anchorMatch.index || 0) + anchorMatch[0].length;
  const tail = upperText.slice(startIndex, startIndex + 60);
  const candidate = extractCandidateFromAnchorTail(tail, 'code');
  if (candidate) {
    return { candidate, parseReason: 'model_no_anchor_text_match' };
  }

  return { candidate: '', parseReason: 'model_no_anchor_no_candidate_in_text' };
}

function parseModelNoCandidateFromLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return { candidate: '', parseReason: 'no_ocr_lines_available' };
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = String(lines[i] || '');
    if (!line.trim()) {
      continue;
    }

    const anchorData = findModelNoAnchorMatch(line);
    if (!anchorData) {
      continue;
    }

    const { anchorMatch, upperText } = anchorData;
    const startIndex = (anchorMatch.index || 0) + anchorMatch[0].length;
    const currentTail = upperText.slice(startIndex, startIndex + 60);
    const candidateFromSameLine = extractCandidateFromAnchorTail(currentTail, 'code');
    if (candidateFromSameLine) {
      return { candidate: candidateFromSameLine, parseReason: 'model_no_anchor_line_match' };
    }

    // Some labels place code on the next line after MODEL NO.
    const nextLine = String(lines[i + 1] || '').toUpperCase();
    const candidateFromNextLine = extractCandidateFromAnchorTail(nextLine, 'code');
    if (candidateFromNextLine) {
      return { candidate: candidateFromNextLine, parseReason: 'model_no_anchor_next_line_match' };
    }
  }

  return { candidate: '', parseReason: 'model_no_anchor_not_found_in_lines' };
}

function parseFieldCandidateFromLines(lines, fieldConfig) {
  const { name: fieldName, extractor } = fieldConfig;
  if (!Array.isArray(lines) || lines.length === 0) {
    return { candidate: '', parseReason: `${fieldName}:no_ocr_lines_available` };
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = String(lines[i] || '');
    if (!line.trim()) {
      continue;
    }

    const anchorData = findFieldAnchorMatch(line, fieldName);
    if (!anchorData) {
      continue;
    }

    const { anchorMatch, upperText } = anchorData;
    const startIndex = (anchorMatch.index || 0) + anchorMatch[0].length;
    const currentTail = upperText.slice(startIndex, startIndex + 60);
    const candidateFromSameLine = extractCandidateFromAnchorTail(currentTail, extractor);
    if (candidateFromSameLine) {
      return { candidate: candidateFromSameLine, parseReason: `${fieldName}:line_match` };
    }

    const nextLine = String(lines[i + 1] || '').toUpperCase();
    const candidateFromNextLine = extractCandidateFromAnchorTail(nextLine, extractor);
    if (candidateFromNextLine) {
      return { candidate: candidateFromNextLine, parseReason: `${fieldName}:next_line_match` };
    }
  }

  return { candidate: '', parseReason: `${fieldName}:anchor_not_found_in_lines` };
}

function parseFieldCandidateFromText(rawText, fieldConfig) {
  const { name: fieldName, extractor } = fieldConfig;
  const upperText = String(rawText || '').toUpperCase();
  if (!upperText.trim()) {
    return { candidate: '', parseReason: `${fieldName}:empty_ocr_text` };
  }

  const anchorData = findFieldAnchorMatch(upperText, fieldName);
  if (!anchorData) {
    return { candidate: '', parseReason: `${fieldName}:anchor_not_found` };
  }

  const { anchorMatch } = anchorData;
  const startIndex = (anchorMatch.index || 0) + anchorMatch[0].length;
  const tail = upperText.slice(startIndex, startIndex + 60);
  const candidate = extractCandidateFromAnchorTail(tail, extractor);
  if (candidate) {
    return { candidate, parseReason: `${fieldName}:text_match` };
  }

  return { candidate: '', parseReason: `${fieldName}:anchor_no_candidate_in_text` };
}

function extractRequestedFields(rawText, rawLines, requestedFieldConfigs) {
  const extractedFields = {};
  const missingFields = [];
  const optionalMissingFields = [];
  const parseDebug = {};

  for (const fieldConfig of requestedFieldConfigs) {
    const fieldName = fieldConfig.name;
    const fromLines = parseFieldCandidateFromLines(rawLines, fieldConfig);
    const fromText = parseFieldCandidateFromText(rawText, fieldConfig);
    const value = fromLines.candidate || fromText.candidate || '';

    if (value) {
      extractedFields[fieldName] = value;
      parseDebug[fieldName] = fromLines.candidate ? fromLines.parseReason : fromText.parseReason;
    } else {
      if (fieldConfig.required) {
        missingFields.push(fieldName);
      } else {
        optionalMissingFields.push(fieldName);
      }
      parseDebug[fieldName] = fromLines.parseReason || fromText.parseReason;
    }
  }

  return {
    extractedFields,
    missingFields,
    optionalMissingFields,
    allRequestedFound: missingFields.length === 0,
    parseDebug
  };
}

function findRegexCandidate(rawText, codeRegex) {
  const upperText = String(rawText || '').toUpperCase();
  if (!upperText.trim()) {
    return '';
  }

  const searchRegex = new RegExp(stripAnchors(codeRegex.source), 'g');
  const matches = upperText.match(searchRegex) || [];
  for (const match of matches) {
    const normalized = normalizeCode(match);
    if (normalized && codeRegex.test(normalized)) {
      return normalized;
    }
  }

  return '';
}

async function preprocessBase64Image(imageBase64) {
  const normalized = imageBase64.replace(/^data:image\/\w+;base64,/, '');
  const inputBuffer = Buffer.from(normalized, 'base64');

  // Preprocessing optimized for printed label text:
  // grayscale + normalize contrast + sharpen.
  return sharp(inputBuffer)
    .grayscale()
    .normalize()
    .sharpen()
    .png()
    .toBuffer();
}

async function runTesseract(preprocessedBuffer) {
  let tesseractLib;
  try {
    // Optional dependency for temporary demo OCR.
    tesseractLib = require('tesseract.js');
  } catch (error) {
    throw new Error(
      'OCR dependency not found. Install with: npm install tesseract.js'
    );
  }

  const { data } = await tesseractLib.recognize(preprocessedBuffer, 'eng', {
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-'
  });

  const text = (data && data.text) ? data.text : '';
  const confidence = data && typeof data.confidence === 'number'
    ? Math.max(0, Math.min(1, data.confidence / 100))
    : 0;
  const lines = Array.isArray(data && data.lines)
    ? data.lines.map((line) => line && line.text ? String(line.text) : '').filter(Boolean)
    : [];

  return { text, confidence, lines };
}

function resolveMinConfidence(minConfidence, confidenceThreshold) {
  const parsedOverride = Number(confidenceThreshold);
  if (!Number.isFinite(parsedOverride)) {
    return minConfidence;
  }
  if (parsedOverride < 0 || parsedOverride > 1) {
    return minConfidence;
  }
  return parsedOverride;
}

async function extractCodeFromFrame({ imageBase64, ocrText, confidence, confidenceThreshold, extractFields }) {
  const { codeRegex, minConfidence } = getValidationConfig();
  const minConfidenceUsed = resolveMinConfidence(minConfidence, confidenceThreshold);
  const requestedFieldConfigs = sanitizeExtractFields(extractFields);
  const requestedFields = requestedFieldConfigs.map((item) => item.name);

  // For quick demo/testing you can pass ocrText directly from client.
  let rawText = '';
  let rawLines = [];
  let effectiveConfidence = Number.isFinite(Number(confidence)) ? Number(confidence) : 0.99;
  let sourceType = 'manual';

  if (typeof ocrText === 'string' && ocrText.trim()) {
    rawText = ocrText.trim();
  } else {
    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return {
        accepted: false,
        reason: 'Missing imageBase64 or ocrText',
        code: null,
        confidence: 0,
        ocrRawText: ''
      };
    }

    const preprocessed = await preprocessBase64Image(imageBase64);
    const tesseractResult = await runTesseract(preprocessed);
    rawText = tesseractResult.text;
    rawLines = Array.isArray(tesseractResult.lines) ? tesseractResult.lines : [];
    effectiveConfidence = tesseractResult.confidence;
    sourceType = 'ocr';
  }

  const modelNoLineParse = parseModelNoCandidateFromLines(rawLines);
  const modelNoParse = parseModelNoCandidate(rawText);
  const requestedFieldResult = extractRequestedFields(rawText, rawLines, requestedFieldConfigs);
  const extractedModelNo = requestedFieldResult.extractedFields['MODEL NO'] || '';
  const primaryRequestedField = resolvePrimaryRequestedField(
    requestedFieldConfigs,
    requestedFieldResult.extractedFields
  );
  const primaryRequestedValue = primaryRequestedField
    ? requestedFieldResult.extractedFields[primaryRequestedField]
    : '';
  const regexCandidate = findRegexCandidate(rawText, codeRegex);
  const normalizedCode = extractedModelNo
    || primaryRequestedValue
    || modelNoLineParse.candidate
    || modelNoParse.candidate
    || regexCandidate
    || normalizeCode(rawText);
  const hasRequestedFields = requestedFieldConfigs.length > 0;
  const shouldBypassCodeRegex = hasRequestedFields && requestedFieldResult.allRequestedFound && Boolean(primaryRequestedValue);
  const parseReason = modelNoLineParse.candidate
    ? modelNoLineParse.parseReason
    : (modelNoParse.candidate ? modelNoParse.parseReason : modelNoParse.parseReason);
  if (!normalizedCode) {
    return {
      accepted: false,
      reason: 'OCR returned empty text',
      code: null,
      confidence: effectiveConfidence,
      ocrRawText: rawText,
      sourceType,
      parsedCandidate: '',
      parseReason,
      minConfidenceUsed,
      requestedFields,
      requestedFieldConfigs,
      extractedFields: requestedFieldResult.extractedFields,
      missingFields: requestedFieldResult.missingFields,
      optionalMissingFields: requestedFieldResult.optionalMissingFields,
      allRequestedFound: requestedFieldResult.allRequestedFound,
      fieldParseDebug: requestedFieldResult.parseDebug,
      primaryRequestedField: primaryRequestedField || null
    };
  }

  if (!shouldBypassCodeRegex && !codeRegex.test(normalizedCode)) {
    return {
      accepted: false,
      reason: 'Code format does not match configured regex',
      code: normalizedCode,
      confidence: effectiveConfidence,
      ocrRawText: rawText,
      sourceType,
      parsedCandidate: modelNoLineParse.candidate || modelNoParse.candidate || regexCandidate || '',
      parseReason: (modelNoLineParse.candidate || modelNoParse.candidate)
        ? parseReason
        : (regexCandidate ? 'regex_candidate_match_failed_validation' : parseReason),
      minConfidenceUsed,
      requestedFields,
      requestedFieldConfigs,
      extractedFields: requestedFieldResult.extractedFields,
      missingFields: requestedFieldResult.missingFields,
      optionalMissingFields: requestedFieldResult.optionalMissingFields,
      allRequestedFound: requestedFieldResult.allRequestedFound,
      fieldParseDebug: requestedFieldResult.parseDebug,
      primaryRequestedField: primaryRequestedField || null
    };
  }

  if (effectiveConfidence < minConfidenceUsed) {
    return {
      accepted: false,
      reason: 'Confidence below threshold',
      code: normalizedCode,
      confidence: effectiveConfidence,
      ocrRawText: rawText,
      sourceType,
      parsedCandidate: modelNoLineParse.candidate || modelNoParse.candidate || regexCandidate || normalizedCode,
      parseReason,
      minConfidenceUsed,
      requestedFields,
      requestedFieldConfigs,
      extractedFields: requestedFieldResult.extractedFields,
      missingFields: requestedFieldResult.missingFields,
      optionalMissingFields: requestedFieldResult.optionalMissingFields,
      allRequestedFound: requestedFieldResult.allRequestedFound,
      fieldParseDebug: requestedFieldResult.parseDebug,
      primaryRequestedField: primaryRequestedField || null
    };
  }

  return {
    accepted: true,
    reason: null,
    code: normalizedCode,
    confidence: effectiveConfidence,
    ocrRawText: rawText,
    sourceType,
    parsedCandidate: modelNoLineParse.candidate || modelNoParse.candidate || regexCandidate || normalizedCode,
    parseReason,
    minConfidenceUsed,
    requestedFields,
    requestedFieldConfigs,
    extractedFields: requestedFieldResult.extractedFields,
    missingFields: requestedFieldResult.missingFields,
    optionalMissingFields: requestedFieldResult.optionalMissingFields,
    allRequestedFound: requestedFieldResult.allRequestedFound,
    fieldParseDebug: requestedFieldResult.parseDebug,
    primaryRequestedField: primaryRequestedField || null
  };
}

module.exports = {
  extractCodeFromFrame,
  normalizeCode
};
