/***** 批次刪分頁：可自動解除保護後刪除 *****/
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🧹 批次工具')
    .addItem('建立/重建 分頁控制台', 'buildControlSheet')
    .addItem('系統初始化(建立必要分頁)', 'runSystemInitialization')
    .addItem('刪除勾選分頁', 'deleteCheckedTabs')
    .addItem('應用隱藏設定', 'applyHiddenTabs')
    .addItem('號碼重新檢查工具', 'syncAssetSerialCounters')
    .addToUi();
}

function runSystemInitialization() {
  const ui = SpreadsheetApp.getUi();
  try {
    const res = initializeSystemOnPageLoad();
    if (res && res.success) {
      ui.alert('✅ 系統初始化完成。');
    } else {
      ui.alert('⚠️ 系統初始化失敗：' + (res && res.message ? res.message : '未知錯誤'));
    }
  } catch (e) {
    ui.alert('❌ 系統初始化發生錯誤：' + e.toString());
  }
}

function buildControlSheet() {
  const ss = SpreadsheetApp.getActive();
  const CTRL = '🧭分頁控制台';
  const old = ss.getSheetByName(CTRL);
  if (old) ss.deleteSheet(old);

  const sh = ss.insertSheet(CTRL, 0);
  sh.getRange('A1:F1').setValues([['刪除?','分頁名稱','保護狀態','列 × 欄','隱藏?','備註']]);
  sh.setFrozenRows(1);

  const sheets = ss.getSheets();
  const protMap = getSheetProtectionMap_(ss);

  const data = sheets.map(s => {
    const name = s.getName();
    const isHidden = s.isSheetHidden(); // 檢查該分頁是否已隱藏
    return [
      false,
      name,
      protMap.has(name) ? '受保護' : '',
      `${s.getMaxRows()} × ${s.getMaxColumns()}`,
      isHidden, // E 欄：現在隱藏狀態
      ''
    ];
  });

  if (data.length) sh.getRange(2,1,data.length,6).setValues(data);
  sh.getRange(2,1,data.length,1).insertCheckboxes(); // A 欄：刪除
  sh.getRange(2,5,data.length,1).insertCheckboxes(); // E 欄：隱藏
  sh.autoResizeColumns(1,6);
  SpreadsheetApp.getUi().alert('已建立「🧭分頁控制台」。\n\n• 勾選 A 欄後執行「刪除勾選分頁」\n• 勾選 E 欄後執行「應用隱藏設定」');
}

function deleteCheckedTabs() {
  const ss  = SpreadsheetApp.getActive();
  const ui  = SpreadsheetApp.getUi();
  const CTRL= '🧭分頁控制台';
  const ctrl= ss.getSheetByName(CTRL);
  if (!ctrl) throw new Error('找不到「🧭分頁控制台」，請先建立。');

  const rows = ctrl.getLastRow() - 1;
  if (rows <= 0) throw new Error('控制台沒有任何分頁列。');

  const vals = ctrl.getRange(2,1,rows,2).getValues(); // A 勾選, B 名稱
  const toDelete = vals.filter(r => r[0] === true).map(r => r[1]);

  if (toDelete.length === 0) throw new Error('沒有勾選任何分頁。');
  if (toDelete.includes(CTRL)) throw new Error('不能刪除控制台本身。');
  if (ss.getSheets().length - toDelete.length < 1) throw new Error('至少需保留 1 個分頁。');

  // 找出受保護分頁
  const protMap = getSheetProtectionMap_(ss); // Map<sheetName, Protection[]>
  const protectedTargets = toDelete.filter(n => protMap.has(n));

  // 如果有受保護分頁，詢問是否先解除保護
  if (protectedTargets.length > 0) {
    const resp = ui.alert(
      '受保護分頁',
      '下列分頁受保護：\n\n' + protectedTargets.join('\n') +
      '\n\n是否嘗試先「解除保護」再刪除？（僅能解除你有權限的保護）',
      ui.ButtonSet.YES_NO
    );
    if (resp === ui.Button.YES) {
      const {unprotected, failed} = tryUnprotectSheets_(ss, protectedTargets, protMap);
      // 更新名單：未成功解除的保留不刪
      if (failed.length > 0) {
        // 從待刪名單移除無法解除者
        for (const n of failed) {
          const idx = toDelete.indexOf(n);
          if (idx >= 0) toDelete.splice(idx,1);
        }
        ui.alert('無權解除保護，已跳過：\n' + failed.join('\n'));
      }
    } else {
      // 使用者拒絕解除保護：把受保護分頁從刪除名單移除
      protectedTargets.forEach(n => {
        const i = toDelete.indexOf(n);
        if (i >= 0) toDelete.splice(i,1);
      });
      if (toDelete.length === 0) {
        throw new Error('受保護分頁已保留，未執行刪除。');
      }
    }
  }

  // 二次確認
  const cfm = ui.alert(
    '確認刪除',
    `即將刪除 ${toDelete.length} 個分頁：\n\n${toDelete.join('\n')}\n\n此動作無法復原，確定嗎？`,
    ui.ButtonSet.YES_NO
  );
  if (cfm !== ui.Button.YES) return;

  // 執行刪除
  toDelete.forEach(n => {
    const sh = ss.getSheetByName(n);
    if (sh) ss.deleteSheet(sh);
  });

  ui.alert('刪除完成：' + toDelete.length + ' 個分頁。');
  buildControlSheet();
}

/* ---------- Helpers ---------- */

// 回傳 Map<sheetName, Protection[]>（僅 SHEET 類型）
function getSheetProtectionMap_(ss) {
  const map = new Map();
  ss.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(p => {
    const name = p.getRange().getSheet().getName();
    if (!map.has(name)) map.set(name, []);
    map.get(name).push(p);
  });
  return map;
}

// 嘗試解除指定分頁的所有 SHEET 保護
function tryUnprotectSheets_(ss, names, protMap) {
  const unprotected = [];
  const failed = [];
  names.forEach(n => {
    const protList = protMap.get(n) || [];
    let ok = true;
    protList.forEach(p => {
      if (p.canEdit()) {
        try { p.remove(); } catch (e) { ok = false; }
      } else {
        ok = false;
      }
    });
    if (ok) unprotected.push(n); else failed.push(n);
  });
  return {unprotected, failed};
}

/**
 * 🔧 應用隱藏設定：根據第 E 欄的勾選狀態隱藏/顯示分頁
 */
function applyHiddenTabs() {
  const ss = SpreadsheetApp.getActive();
  const ui = SpreadsheetApp.getUi();
  const CTRL = '🧭分頁控制台';
  const ctrl = ss.getSheetByName(CTRL);
  
  if (!ctrl) {
    throw new Error('找不到「🧭分頁控制台」，請先建立。');
  }
  
  const rows = ctrl.getLastRow() - 1;
  if (rows <= 0) throw new Error('控制台沒有任何分頁列。');
  
  // 讀取 B 欄（分頁名稱）和 E 欄（隱藏?）
  const vals = ctrl.getRange(2, 2, rows, 4).getValues(); // B:E
  let hiddenCount = 0;
  let shownCount = 0;
  
  vals.forEach(r => {
    const sheetName = r[0]; // B 欄
    const shouldHide = r[3]; // E 欄
    
    if (sheetName === CTRL) return; // 不操作控制台本身
    
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return;
    
    if (shouldHide === true) {
      // 勾選 = 隱藏
      if (!sheet.isSheetHidden()) {
        try {
          sheet.hideSheet();
          hiddenCount++;
        } catch (e) {
          ui.alert('❌ 無法隱藏「' + sheetName + '」：' + e.toString());
        }
      }
    } else {
      // 未勾選 = 顯示
      if (sheet.isSheetHidden()) {
        try {
          sheet.showSheet();
          shownCount++;
        } catch (e) {
          ui.alert('❌ 無法顯示「' + sheetName + '」：' + e.toString());
        }
      }
    }
  });
  
  ui.alert(`✅ 隱藏設定已應用！\n隱藏了 ${hiddenCount} 個分頁\n顯示了 ${shownCount} 個分頁`);
}