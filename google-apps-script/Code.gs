// セミナーアンケートシステム - Google Apps Script Web App
// スプレッドシートの構成:
// シート1 (questions): id, question_text, question_type, options, is_required, is_active, sort_order, created_at
// シート2 (responses): id, question_id, session_id, answer, created_at

// スプレッドシートID（デプロイ時に設定してください）
const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID_HERE';

// GETリクエスト処理
function doGet(e) {
  const action = e.parameter.action;
  Logger.log('doGet called with action: ' + action);

  try {
    if (action === 'getQuestions') {
      return getQuestions();
    } else if (action === 'getResponses') {
      return getResponses();
    } else if (action === 'addResponse' || action === 'addQuestion' ||
               action === 'updateQuestion' || action === 'deleteQuestion') {
      // データはクエリパラメータ 'data' から取得
      const dataStr = e.parameter.data;
      Logger.log('Received data parameter: ' + (dataStr ? dataStr.substring(0, 100) : 'null'));

      if (!dataStr) {
        Logger.log('ERROR: Missing data parameter');
        return createResponse({error: 'Missing data parameter'}, 400);
      }

      const decodedStr = decodeURIComponent(dataStr);
      Logger.log('Decoded data: ' + decodedStr.substring(0, 200));

      const data = JSON.parse(decodedStr);

      if (action === 'addResponse') {
        return addResponse(data);
      } else if (action === 'addQuestion') {
        return addQuestion(data);
      } else if (action === 'updateQuestion') {
        return updateQuestion(data);
      } else if (action === 'deleteQuestion') {
        return deleteQuestion(data);
      }
    } else {
      Logger.log('ERROR: Invalid action - ' + action);
      return createResponse({error: 'Invalid action'}, 400);
    }
  } catch (error) {
    Logger.log('ERROR in doGet: ' + error.toString());
    return createResponse({error: error.toString()}, 500);
  }
}

// POSTリクエスト処理（管理機能用、非推奨）
// GETでも処理できるよう、doGetで全て処理
function doPost(e) {
  // 下位互換性のため残すが、GETの使用を推奨
  const action = e.parameter.action;
  let data;

  try {
    if (e.postData && e.postData.contents) {
      data = JSON.parse(e.postData.contents);
    } else if (e.parameter.data) {
      data = JSON.parse(e.parameter.data);
    } else {
      return createResponse({error: 'Missing data'}, 400);
    }
  } catch (error) {
    return createResponse({error: 'Invalid JSON: ' + error.toString()}, 400);
  }

  try {
    if (action === 'addResponse') {
      return addResponse(data);
    } else if (action === 'addQuestion') {
      return addQuestion(data);
    } else if (action === 'updateQuestion') {
      return updateQuestion(data);
    } else if (action === 'deleteQuestion') {
      return deleteQuestion(data);
    } else {
      return createResponse({error: 'Invalid action'}, 400);
    }
  } catch (error) {
    return createResponse({error: error.toString()}, 500);
  }
}

// 質問一覧取得
function getQuestions() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('questions');

  if (!sheet) {
    return createResponse({error: 'questions sheet not found'}, 404);
  }

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const questions = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue; // 空行をスキップ

    const question = {
      id: row[0],
      question_text: row[1],
      question_type: row[2],
      options: row[3] ? JSON.parse(row[3]) : null,
      is_required: row[4],
      is_active: row[5],
      sort_order: row[6],
      created_at: row[7]
    };
    questions.push(question);
  }

  return createResponse(questions);
}

// 回答一覧取得
function getResponses() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('responses');

  if (!sheet) {
    return createResponse({error: 'responses sheet not found'}, 404);
  }

  const data = sheet.getDataRange().getValues();
  const responses = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;

    const response = {
      id: row[0],
      question_id: row[1],
      session_id: row[2],
      answer: row[3],
      created_at: row[4]
    };
    responses.push(response);
  }

  return createResponse(responses);
}

// 回答追加
function addResponse(data) {
  try {
    Logger.log('addResponse called with data: ' + JSON.stringify(data));

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName('responses');

    if (!sheet) {
      Logger.log('ERROR: responses sheet not found');
      return createResponse({error: 'responses sheet not found'}, 404);
    }

    // 複数回答を一括追加
    const responses = Array.isArray(data) ? data : [data];
    Logger.log('Processing ' + responses.length + ' responses');

    responses.forEach((response, index) => {
      // 現在の最終行を取得（ヘッダー含む）
      const lastRow = sheet.getLastRow();
      // IDは最終行番号（ヘッダーを除く）
      const id = lastRow; // ヘッダーが1行目なので、lastRowがそのままIDになる

      Logger.log('Adding response ' + (index + 1) + ' with ID: ' + id);

      sheet.appendRow([
        id,
        response.question_id,
        response.session_id,
        response.answer,
        response.created_at || new Date().toISOString()
      ]);
    });

    Logger.log('Successfully added ' + responses.length + ' responses');
    return createResponse({success: true, count: responses.length});

  } catch (error) {
    Logger.log('ERROR in addResponse: ' + error.toString());
    return createResponse({error: 'Failed to add response: ' + error.toString()}, 500);
  }
}

// 質問追加
function addQuestion(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('questions');

  if (!sheet) {
    return createResponse({error: 'questions sheet not found'}, 404);
  }

  const lastRow = sheet.getLastRow();
  const id = lastRow > 0 ? lastRow : 1;

  const optionsJson = data.options ? JSON.stringify(data.options) : '';

  sheet.appendRow([
    id,
    data.question_text,
    data.question_type,
    optionsJson,
    data.is_required !== undefined ? data.is_required : true,
    data.is_active !== undefined ? data.is_active : true,
    data.sort_order || 0,
    new Date().toISOString()
  ]);

  const newQuestion = {
    id: id,
    question_text: data.question_text,
    question_type: data.question_type,
    options: data.options,
    is_required: data.is_required !== undefined ? data.is_required : true,
    is_active: data.is_active !== undefined ? data.is_active : true,
    sort_order: data.sort_order || 0,
    created_at: new Date().toISOString()
  };

  return createResponse(newQuestion);
}

// 質問更新
function updateQuestion(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('questions');

  if (!sheet) {
    return createResponse({error: 'questions sheet not found'}, 404);
  }

  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();

  for (let i = 1; i < values.length; i++) {
    if (values[i][0] == data.id) {
      // 指定されたフィールドのみ更新
      if (data.is_active !== undefined) {
        sheet.getRange(i + 1, 6).setValue(data.is_active);
      }
      return createResponse({success: true});
    }
  }

  return createResponse({error: 'Question not found'}, 404);
}

// 質問削除
function deleteQuestion(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const questionsSheet = ss.getSheetByName('questions');
  const responsesSheet = ss.getSheetByName('responses');

  if (!questionsSheet) {
    return createResponse({error: 'questions sheet not found'}, 404);
  }

  // 関連する回答を削除
  if (responsesSheet) {
    const responseData = responsesSheet.getDataRange().getValues();
    for (let i = responseData.length - 1; i > 0; i--) {
      if (responseData[i][1] == data.id) {
        responsesSheet.deleteRow(i + 1);
      }
    }
  }

  // 質問を削除
  const questionData = questionsSheet.getDataRange().getValues();
  for (let i = 1; i < questionData.length; i++) {
    if (questionData[i][0] == data.id) {
      questionsSheet.deleteRow(i + 1);
      return createResponse({success: true});
    }
  }

  return createResponse({error: 'Question not found'}, 404);
}

// レスポンス作成ヘルパー
function createResponse(data, statusCode = 200) {
  const output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);

  // CORS対応
  if (statusCode !== 200) {
    // エラーレスポンスの場合もCORS対応
    return output;
  }

  return output;
}
