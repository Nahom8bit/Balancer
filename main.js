const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const Database = require('./database');
const markdownpdf = require("markdown-pdf");
const os = require('os');
const log = require('electron-log');
const { autoUpdater } = require("electron-updater");

// Add this function near the top of the file
function formatMoney(amount) {
    return amount.toFixed(2).replace(/\d(?=(\d{3})+\.)/g, '$&,') + ' Kz';
}

let mainWindow;
const db = new Database();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true
    }
  });

  mainWindow.loadFile('index.html');
  
  const template = [
    {
      label: 'File',
      submenu: [
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Undo',
          accelerator: 'CmdOrCtrl+Z',
          click: () => mainWindow.webContents.send('menu-undo')
        },
        {
          label: 'Redo',
          accelerator: 'CmdOrCtrl+Y',
          click: () => mainWindow.webContents.send('menu-redo')
        }
      ]
    },
    {
      label: 'Reports',
      submenu: [
        {
          label: 'Generate Report',
          click: () => mainWindow.webContents.send('menu-generate-report')
        },
        {
          label: 'View Previous Reports',
          click: () => mainWindow.webContents.send('menu-view-previous-report')
        }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Check for Updates',
          click: () => autoUpdater.checkForUpdatesAndNotify()
        },
        { type: 'separator' },
        {
          label: 'About',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              title: 'About Balancer',
              message: 'Balancer v' + app.getVersion(),
              detail: 'A shop closing management application.'
            });
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
  createWindow();
  autoUpdater.checkForUpdatesAndNotify();
  
  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// Add this to allow loading local resources
app.on('web-contents-created', (event, contents) => {
  contents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': ["default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline';"]
      }
    })
  })
})

// IPC handlers for database operations
function isClosingTime() {
    const now = new Date();
    const hour = now.getHours();
    // Assume closing time is between 6 PM and midnight
    return hour >= 18 && hour < 24;
}

ipcMain.handle('is-closing-time', async (event) => {
    return isClosingTime();
});

ipcMain.handle('db-insert', async (event, table, data) => {
    if (!isClosingTime()) {
        throw new Error("Data can only be entered during closing time (6 PM - midnight).");
    }
    try {
        log.info('Received insert request:', table, data);
        return await db.insert(table, data);
    } catch (error) {
        log.error('Error in db-insert:', error);
        throw error;
    }
});

ipcMain.handle('db-select', async (event, table) => {
  try {
    log.info('Received select request:', table);
    return await db.select(table);
  } catch (error) {
    log.error('Error in db-select:', error);
    throw error;
  }
});

ipcMain.handle('db-update', async (event, table, id, data) => {
  try {
    log.info('Received update request:', table, id, data);
    return await db.update(table, id, data);
  } catch (error) {
    log.error('Error in db-update:', error);
    throw error;
  }
});

ipcMain.handle('db-delete', async (event, table, id) => {
  try {
    log.info('Received delete request:', table, id);
    return await db.delete(table, id);
  } catch (error) {
    log.error('Error in db-delete:', error);
    throw error;
  }
});

ipcMain.handle('generate-pdf', async (event, data) => {
  try {
    log.info('Received generate PDF request');
    // Generate Markdown content
    let markdownContent = `# Balancer: Shop Closing Report\n\nDate: ${new Date().toLocaleDateString()}\n\n`;

    for (const [table, entries] of Object.entries(data)) {
      markdownContent += `## ${table.replace('_', ' ').toUpperCase()}\n\n`;
      if (entries.length > 0) {
        const headers = Object.keys(entries[0]).filter(key => key !== 'id' && key !== 'date');
        markdownContent += `| ${headers.join(' | ')} |\n`;
        markdownContent += `| ${headers.map(() => '---').join(' | ')} |\n`;
        entries.forEach(entry => {
          markdownContent += `| ${headers.map(header => entry[header]).join(' | ')} |\n`;
        });
      } else {
        markdownContent += 'No entries\n';
      }
      markdownContent += '\n';
    }

    // Calculate balance
    const sumAmount = (items) => items.reduce((sum, item) => sum + item.amount, 0);
    const totalPettyCash = sumAmount(data.petty_cash || []);
    const totalPurchases = sumAmount(data.purchase || []);
    const totalPayments = sumAmount(data.payment || []);
    const totalOpeningBalance = sumAmount(data.opening_balance || []);
    const totalClosingBalance = sumAmount(data.closing_balance || []);
    const totalSales = sumAmount(data.sales || []);

    const checkingBalance = totalPettyCash + totalPurchases + totalClosingBalance -
                              (totalPayments + totalOpeningBalance);

    const difference = checkingBalance - totalSales;

    // Add balance check to the Markdown
    markdownContent += `## Balance Check\n\n`;
    markdownContent += `Formula: (Petty Cash + Purchases + Closing Balance) - (Payments + Opening Balance) = Checking Balance\n\n`;
    markdownContent += `(${totalPettyCash.toFixed(2)} + ${totalPurchases.toFixed(2)} + ${totalClosingBalance.toFixed(2)}) - (${totalPayments.toFixed(2)} + ${totalOpeningBalance.toFixed(2)}) = ${checkingBalance.toFixed(2)}\n\n`;
    markdownContent += `Checking Balance: ${formatMoney(checkingBalance)}\n`;
    markdownContent += `Total Sales: ${formatMoney(totalSales)}\n`;
    markdownContent += `Difference: ${Math.abs(difference).toFixed(2)} Kz\n\n`;
    markdownContent += `**${difference < 0 ? 'Missing amount' : difference > 0 ? 'Excess amount' : 'Balanced'}**\n`;

    // Write Markdown to a temporary file
    const tempFile = path.join(os.tmpdir(), 'balancer_report.md');
    fs.writeFileSync(tempFile, markdownContent);

    // Ask user where to save the file
    const { filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Save Balancer Report',
      defaultPath: path.join(app.getPath('documents'), 'Balancer_Report.pdf'),
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
    });

    if (!filePath) {
      console.log('PDF generation cancelled');
      return { success: false, message: 'PDF generation cancelled' };
    }

    // Convert Markdown to PDF
    await new Promise((resolve, reject) => {
      markdownpdf().from(tempFile).to(filePath, (err) => {
        if (err) {
          console.error('Error generating PDF:', err);
          reject(err);
        } else {
          console.log('Balancer report generated:', filePath);
          resolve();
        }
      });
    });

    // Clean up temporary file
    fs.unlinkSync(tempFile);

    // Open the folder containing the PDF
    shell.showItemInFolder(filePath);

    return { success: true, message: 'Balancer report generated successfully', filePath };
  } catch (error) {
    log.error('Error generating PDF:', error);
    return { success: false, message: 'Error generating PDF: ' + error.message };
  }
});

// Auto-updater events
autoUpdater.on('update-available', () => {
  log.info('Update available');
  mainWindow.webContents.send('update_available');
});

autoUpdater.on('update-downloaded', () => {
  log.info('Update downloaded');
  mainWindow.webContents.send('update_downloaded');
});
