let undoStack = [];
let redoStack = [];

document.addEventListener('DOMContentLoaded', async () => {
    if (await window.api.isClosingTime()) {
        loadData();
        setupEventListeners();
        setupMenuListeners();
        setupThemeToggle();
    } else {
        alert("This app can only be used during closing time (6 PM - midnight).");
        // Disable data entry or hide the UI
    }
});

function setupEventListeners() {
    document.getElementById('undo').addEventListener('click', handleUndo);
    document.getElementById('redo').addEventListener('click', handleRedo);
    document.getElementById('generate-report').addEventListener('click', generateReport);
    document.getElementById('view-previous-report').addEventListener('click', viewPreviousReport);

    // Modal event listeners
    const modal = document.getElementById('modal');
    const closeBtn = document.getElementsByClassName('close')[0];
    closeBtn.onclick = () => modal.style.display = 'none';
    window.onclick = (event) => {
        if (event.target == modal) {
            modal.style.display = 'none';
        }
    };
}

async function loadData() {
    const tables = ['opening_balance', 'closing_balance', 'sales', 'purchase', 'petty_cash', 'payment'];
    const dataPreview = document.getElementById('data-preview');
    dataPreview.innerHTML = '';

    for (const table of tables) {
        const data = await window.api.dbSelect(table);
        const tableElement = createTableElement(table, data);
        dataPreview.appendChild(tableElement);
    }

    await calculateBalance();
}

function createTableElement(table, data) {
    const tableDiv = document.createElement('div');
    tableDiv.className = 'data-card';
    
    const title = table.replace('_', ' ').toUpperCase();
    const total = sumAmount(data);
    const headers = Object.keys(data[0] || {}).filter(key => key !== 'id' && key !== 'date');
    
    tableDiv.innerHTML = `
        <div class="card-header">
            <h2>${title}</h2>
            <p class="amount-total">Total: ${formatMoney(total)}</p>
            ${['opening_balance', 'closing_balance', 'sales'].includes(table) ? '' : '<button class="new-entry-btn" data-table="' + table + '">+ New Entry</button>'}
        </div>
        <div class="card-body">
            <table>
                <thead>
                    <tr>
                        ${headers.map(header => `<th>${header.charAt(0).toUpperCase() + header.slice(1)}</th>`).join('')}
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${data.map(item => `
                        <tr>
                            ${headers.map(header => `<td>${header === 'amount' ? formatMoney(item[header]) : item[header]}</td>`).join('')}
                            <td class="actions">
                                <button class="edit-btn" data-id="${item.id}" data-table="${table}">Edit</button>
                                <button class="delete-btn" data-id="${item.id}" data-table="${table}">Delete</button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;

    tableDiv.querySelector('.new-entry-btn')?.addEventListener('click', () => showEntryModal(table));
    tableDiv.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => showEntryModal(table, e.target.dataset.id));
    });
    tableDiv.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => deleteEntry(table, e.target.dataset.id));
    });

    return tableDiv;
}

function sumAmount(data) {
    return data.reduce((sum, item) => sum + item.amount, 0);
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

async function showEntryModal(table, id = null) {
    const modal = document.getElementById('modal');
    const form = document.getElementById('entry-form');
    const title = document.getElementById('modal-title');

    title.textContent = id ? 'Edit Entry' : 'Add New Entry';
    form.innerHTML = ''; // Clear previous form fields

    const fields = getFieldsForTable(table);
    fields.forEach(field => {
        const label = document.createElement('label');
        label.textContent = field.charAt(0).toUpperCase() + field.slice(1);
        const input = document.createElement('input');
        input.type = field === 'amount' ? 'number' : 'text';
        input.name = field;
        input.required = true;
        form.appendChild(label);
        form.appendChild(input);
    });

    const submitBtn = document.createElement('button');
    submitBtn.textContent = id ? 'Update' : 'Add';
    submitBtn.type = 'submit';
    form.appendChild(submitBtn);

    form.onsubmit = (e) => handleFormSubmit(e, table, id);

    if (id) {
        // Fetch existing data and populate form
        const data = await window.api.dbSelect(table);
        const entry = data.find(item => item.id === parseInt(id));
        if (entry) {
            fields.forEach(field => {
                const input = form.querySelector(`[name="${field}"]`);
                if (input) {
                    input.value = entry[field];
                }
            });
        }
    }

    modal.style.display = 'block';
}

function getFieldsForTable(table) {
    switch (table) {
        case 'opening_balance':
        case 'closing_balance':
        case 'sales':
            return ['amount'];
        case 'petty_cash':
        case 'payment':
            return ['description', 'amount'];
        case 'purchase':
            return ['description', 'type', 'amount'];
        default:
            return [];
    }
}

// Implement input validation
function validateInput(data, table) {
    // Add your validation logic here
    // For now, we'll just check if all fields have values
    return Object.values(data).every(value => value !== '' && value !== null && value !== undefined);
}

async function handleFormSubmit(event, table, id = null) {
    event.preventDefault();
    if (!await window.api.isClosingTime()) {
        alert("Data can only be entered during closing time (6 PM - midnight).");
        return;
    }
    const formData = new FormData(event.target);
    const data = Object.fromEntries(formData.entries());
    data.amount = parseFloat(data.amount);

    if (!validateInput(data, table)) {
        alert('Invalid input. Please check your entries.');
        return;
    }

    try {
        let result;
        if (id) {
            result = await window.api.dbUpdate(table, id, data);
        } else {
            result = await window.api.dbInsert(table, data);
        }
        
        if (result) {
            undoStack.push({ action: id ? 'update' : 'insert', table, id: id || result.id, data });
            redoStack = [];
            await loadData();
            document.getElementById('modal').style.display = 'none';
        } else {
            throw new Error('Operation did not return a result');
        }
    } catch (error) {
        console.error('Error handling form submission:', error);
        alert('An error occurred. Please try again.');
    }
}

async function deleteEntry(table, id) {
    if (confirm('Are you sure you want to delete this entry?')) {
        try {
            await window.api.dbDelete(table, id);
            undoStack.push({ action: 'delete', table, id });
            redoStack = [];
            loadData();
        } catch (error) {
            console.error('Error deleting entry:', error);
        }
    }
}

async function generateReport() {
  try {
    const tables = ['opening_balance', 'petty_cash', 'purchase', 'payment', 'closing_balance', 'sales'];
    const reportData = {};

    for (const table of tables) {
      reportData[table] = await window.api.dbSelect(table);
    }

    const result = await window.api.generatePdf(reportData);
    
    if (result.success) {
      alert(`Balancer report generated successfully and saved to: ${result.filePath}`);
    } else {
      alert(`Failed to generate Balancer report: ${result.message}`);
    }
  } catch (error) {
    console.error('Error generating Balancer report:', error);
    alert('An error occurred while generating the Balancer report. Please try again.');
  }
}

async function calculateBalance() {
    const openingBalance = await window.api.dbSelect('opening_balance');
    const pettyCash = await window.api.dbSelect('petty_cash');
    const purchases = await window.api.dbSelect('purchase');
    const payments = await window.api.dbSelect('payment');
    const closingBalance = await window.api.dbSelect('closing_balance');
    const sales = await window.api.dbSelect('sales');

    const sumAmount = (items) => items.reduce((sum, item) => sum + item.amount, 0);

    const totalPettyCash = sumAmount(pettyCash);
    const totalPurchases = sumAmount(purchases);
    const totalPayments = sumAmount(payments);
    const totalOpeningBalance = sumAmount(openingBalance);
    const totalClosingBalance = sumAmount(closingBalance);
    const totalSales = sumAmount(sales);

    const checkingBalance = totalPettyCash + totalPurchases + totalClosingBalance -
                            (totalPayments + totalOpeningBalance);

    const difference = checkingBalance - totalSales;

    const balanceResult = document.getElementById('balance-check');
    balanceResult.innerHTML = `
        <h2>Balance Check</h2>
        <div class="balance-grid">
            <div class="balance-item">
                <span>Total Petty Cash:</span>
                <span>${formatMoney(totalPettyCash)}</span>
            </div>
            <div class="balance-item">
                <span>Total Purchases:</span>
                <span>${formatMoney(totalPurchases)}</span>
            </div>
            <div class="balance-item">
                <span>Total Payments:</span>
                <span>${formatMoney(totalPayments)}</span>
            </div>
            <div class="balance-item">
                <span>Opening Balance:</span>
                <span>${formatMoney(totalOpeningBalance)}</span>
            </div>
            <div class="balance-item">
                <span>Closing Balance:</span>
                <span>${formatMoney(totalClosingBalance)}</span>
            </div>
            <div class="balance-item">
                <span>Total Sales:</span>
                <span>${formatMoney(totalSales)}</span>
            </div>
            <div class="balance-item">
                <span>Checking Balance:</span>
                <span>${formatMoney(checkingBalance)}</span>
            </div>
            <div class="balance-item">
                <span>Difference:</span>
                <span>${formatMoney(Math.abs(difference))}</span>
            </div>
        </div>
        <p class="balance-status ${difference < 0 ? 'negative' : difference > 0 ? 'positive' : 'balanced'}">
            ${difference < 0 ? 'Missing amount' : difference > 0 ? 'Excess amount' : 'Balanced'}
        </p>
    `;
}

// Implement undo functionality
async function handleUndo() {
  if (undoStack.length === 0) return;
  const action = undoStack.pop();
  try {
    if (action.action === 'insert') {
      await window.api.dbDelete(action.table, action.id);
    } else if (action.action === 'update') {
      // Fetch the previous state and update
      const previousState = action.previousState;
      await window.api.dbUpdate(action.table, action.id, previousState);
    } else if (action.action === 'delete') {
      await window.api.dbInsert(action.table, action.data);
    }
    redoStack.push(action);
    await loadData();
  } catch (error) {
    console.error('Error during undo:', error);
    alert('An error occurred during undo. Please try again.');
  }
}

// Implement redo functionality
async function handleRedo() {
  // Similar to handleUndo, but use redoStack and reverse the actions
}

// Implement view previous report functionality
async function viewPreviousReport() {
  try {
    const reports = await window.api.getPreviousReports();
    // Implement UI to display and select previous reports
  } catch (error) {
    console.error('Error fetching previous reports:', error);
    alert('An error occurred while fetching previous reports. Please try again.');
  }
}

// Listen for update notifications
window.api.onUpdateAvailable(() => {
  // Notify user of available update
});

window.api.onUpdateDownloaded(() => {
  // Prompt user to install the update
});

// Add this function near the top of the file
function formatMoney(amount) {
    return amount.toFixed(2).replace(/\d(?=(\d{3})+\.)/g, '$&,') + ' Kz';
}

function setupMenuListeners() {
    window.api.onMenuUndo(() => handleUndo());
    window.api.onMenuRedo(() => handleRedo());
    window.api.onMenuGenerateReport(() => generateReport());
    window.api.onMenuViewPreviousReport(() => viewPreviousReport());
}

function setupThemeToggle() {
    const themeToggle = document.getElementById('theme-toggle');
    const themeIcon = document.getElementById('theme-icon');
    
    // Check for saved theme preference or default to 'light'
    const currentTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', currentTheme);
    updateThemeIcon(currentTheme);

    themeToggle.addEventListener('click', () => {
        const newTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        updateThemeIcon(newTheme);
    });
}

function updateThemeIcon(theme) {
    const themeIcon = document.getElementById('theme-icon');
    themeIcon.src = theme === 'dark' ? 'assets/icons/light-theme.png' : 'assets/icons/dark-theme.png';
}
