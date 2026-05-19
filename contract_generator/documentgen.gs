/**
 * documentgen.gs
 * Googleドキュメント生成・PDF変換モジュール
 */

const DocumentGen = {

  generate: function(inputs) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const configSheet = ss.getSheetByName(CONFIG.SHEET_CONFIG);
    if (!configSheet) throw new Error(`設定シートが見つかりません`);

    let templateDocId = configSheet.getRange(CONFIG.CONFIG_TEMPLATE_DOC_ID).getValue().toString().trim();

    if (!templateDocId) {
      const files = DriveApp.searchFiles(
        'title contains "買取契約ひな形_テンプレート" and ' +
        'mimeType = "application/vnd.google-apps.document" and trashed = false'
      );
      if (files.hasNext()) {
        templateDocId = files.next().getId();
        configSheet.getRange(CONFIG.CONFIG_TEMPLATE_DOC_ID).setValue(templateDocId);
        Logger.log(`[DocumentGen] ひな形を自動検出 → B2に保存: ${templateDocId}`);
      } else {
        throw new Error(
          'ひな形ドキュメントが見つかりません。\n' +
          '「買取契約ひな形_テンプレート」をGoogle Driveにアップロードするか、\n' +
          '設定シートB2にドキュメントIDを直接入力してください。'
        );
      }
    }

    let templateFile;
    try {
      templateFile = DriveApp.getFileById(templateDocId);
    } catch (e) {
      throw new Error(`ひな形ドキュメントにアクセスできません。IDを確認してください:\n${templateDocId}`);
    }

    let destFolder;
    try {
      destFolder = DriveApp.getFolderById(inputs.folderId);
    } catch (e) {
      throw new Error(`保存先フォルダにアクセスできません。権限を確認してください。`);
    }

    const newFile = templateFile.makeCopy(inputs.fileName, destFolder);
    const newDocId = newFile.getId();

    try {
      const newDoc = DocumentApp.openById(newDocId);
      const body = newDoc.getBody();
      this._replacePlaceholders(body, inputs);
      this._setKeepWithNext(newDoc);
      newDoc.saveAndClose();
    } catch (e) {
      try { DriveApp.getFileById(newDocId).setTrashed(true); } catch (_) {}
      throw new Error(`ドキュメントの差し込み処理に失敗しました:\n${e.message}`);
    }

    const pdfFile = this.convertToPdf(newDocId, inputs.fileName, inputs.folderId);

    const docUrl = `https://docs.google.com/document/d/${newDocId}/edit`;
    const pdfUrl = `https://drive.google.com/file/d/${pdfFile.getId()}/view`;

    Logger.log(`[DocumentGen] 生成完了: ${inputs.fileName}`);

    return {
      docId: newDocId,
      docUrl,
      pdfUrl,
      pdfFileId: pdfFile.getId(),
      fileName: inputs.fileName,
      folderName: destFolder.getName()
    };
  },

  _replacePlaceholders: function(body, inputs) {
    let specialClauseText = '';
    if (inputs.specialClause && inputs.specialClause.trim() !== '') {
      const nums = ['③','④','⑤','⑥','⑦','⑧','⑨','⑩'];
      const lines = inputs.specialClause.trim().split(/\r?\n|\\n/).filter(l => l.trim() !== '');
      specialClauseText = lines.map((line, i) => {
        const num = nums[i] || '(' + (i+3) + ')';
        return num + line.trim();
      }).join('\n');
    }

    const replacements = [
      ['{{本件物件}}',           inputs.propertyFullName],
      ['{{第1条日付}}',          inputs.article1DateFormatted],
      ['{{契約書①名称}}',        inputs.contract1Name],
      ['{{契約書②名称}}',        inputs.contract2Name],
      ['{{買取金額表記}}',        inputs.priceFormatted],
      ['{{決済期限}}',            inputs.paymentDeadlineFormatted],
      ['{{秘密保持開始日時}}',    inputs.confidentialDate],
      ['{{追加特約事項}}',        specialClauseText],
      ['{{丙の住所}}',            inputs.heiAddress],
      ['{{丙の名称}}',            inputs.heiName],
      ['{{乙の住所}}',            FIXED.OTSU_ADDRESS],
      ['{{乙の名称}}',            FIXED.OTSU_NAME],
      ['{{契約日年}}',            inputs.contractYear],
      ['{{契約日月}}',            inputs.contractMonth],
      ['{{契約日日}}',            inputs.contractDay],
      ['{{振込先口座欄}}',        '振込先口座（ご記入ください）：＿＿＿＿＿＿＿＿＿＿＿＿＿'],
      ['{{甲の住所欄}}',          '　　　　　　　　　　　　　　　　　　　　　　　　　　　'],
      ['{{甲の名称欄}}',          '　　　　　　　　　　　　　　　　　　　　　　　　　　　'],
    ];

    for (const [placeholder, value] of replacements) {
      try {
        body.replaceText(placeholder, value !== null && value !== undefined ? value.toString() : '');
      } catch (e) {
        Logger.log(`[DocumentGen] 置換スキップ（${placeholder}）: ${e.message}`);
      }
    }
  },

  _setKeepWithNext: function(doc) {
    try {
      const body = doc.getBody();
      const numParagraphs = body.getNumChildren();
      let inSignatureBlock = false;
      for (let i = 0; i < numParagraphs; i++) {
        const child = body.getChild(i);
        if (child.getType() !== DocumentApp.ElementType.PARAGRAPH) continue;
        const para = child.asParagraph();
        const text = para.getText();
        if (text.indexOf('日（電子契約で双方が締結完了') !== -1) {
          inSignatureBlock = true;
        }
        if (inSignatureBlock && i < numParagraphs - 1) {
          para.setAttributes({ [DocumentApp.Attribute.KEEP_WITH_NEXT]: true });
        }
      }
      Logger.log('[DocumentGen] keepWithNext設定完了');
    } catch (e) {
      Logger.log('[DocumentGen] keepWithNext設定スキップ: ' + e.message);
    }
  },

  convertToPdf: function(docId, fileName, folderId) {
    const url = `https://docs.google.com/document/d/${docId}/export?format=pdf`;
    const token = ScriptApp.getOAuthToken();
    const response = UrlFetchApp.fetch(url, {
      headers: { 'Authorization': 'Bearer ' + token },
      muteHttpExceptions: true
    });
    if (response.getResponseCode() !== 200) {
      throw new Error(`PDF変換に失敗しました（HTTPステータス: ${response.getResponseCode()}）`);
    }
    const pdfBlob = response.getBlob().setName(fileName + '.pdf');
    const folder = DriveApp.getFolderById(folderId);
    const pdfFile = folder.createFile(pdfBlob);
    Logger.log(`[DocumentGen] PDF保存完了: ${fileName}.pdf`);
    return pdfFile;
  }
};
