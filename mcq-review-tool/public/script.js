// Global variables
let currentRole = null;
let currentUsername = "";
let questions = [];
let locks = {};
let activityLog = [];
let myClientId = 'client_' + Math.random().toString(36).substr(2, 9);
let ws = null;

// Initialize the application
function init() {
    setupEventListeners();
    connectWebSocket();
    updateStatus('Ready');
    showUsernameModal();
}

function showUsernameModal() {
    const modal = document.getElementById('usernameModal');
    modal.classList.add('show');

    document.getElementById('confirmUsername').addEventListener('click', () => {
        const username = document.getElementById('usernameInput').value.trim();
        if (username) {
            currentUsername = username;
            modal.classList.remove('show');
            updateStatus(`Welcome, ${username}!`);
        }
    });
}

function connectWebSocket() {
    ws = new WebSocket('ws://localhost:5000');

    ws.onopen = () => {
        updateStatus('Connected to server');
    };

    ws.onmessage = (e) => {
        try {
            const data = JSON.parse(e.data);

            if (data.type === 'INITIAL_STATE' || data.type === 'STATE_UPDATE') {
                // Full state synchronization
                questions = data.state.questions || [];
                locks = data.state.locks || {};
                activityLog = data.state.activityLog || [];

                renderQuestions();
                updateQuestionCount();
                updateActivityLogDisplay();
            }
        } catch (error) {
            console.error('Error processing message:', error);
        }
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        updateStatus('Connection error');
    };

    ws.onclose = () => {
        updateStatus('Disconnected');
        setTimeout(connectWebSocket, 3000);
    };
}

function setupEventListeners() {
    // Role selection
    document.querySelectorAll('.role-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            selectRole(btn.dataset.role);
        });
    });

    // File input change
    document.getElementById('fileInput').addEventListener('change', handleFileUpload);

    // Upload button
    document.getElementById('uploadBtn').addEventListener('click', () => {
        document.getElementById('fileInput').click();
    });

    // Export button
    document.getElementById('exportBtn').addEventListener('click', exportCSV);

    // Activity log button
    document.getElementById('activityLogBtn').addEventListener('click', toggleActivityLog);

    // Clear log button
    document.getElementById('clearLogBtn').addEventListener('click', clearActivityLog);

    // Drag and drop
    const uploadSection = document.getElementById('uploadSection');
    uploadSection.addEventListener('dragover', handleDragOver);
    uploadSection.addEventListener('dragleave', handleDragLeave);
    uploadSection.addEventListener('drop', handleFileDrop);
}

function selectRole(role) {
    if (!currentUsername) {
        showAlert('Please enter your username first', 'error');
        showUsernameModal();
        return;
    }

    currentRole = role;
    document.getElementById('roleSelection').style.display = 'none';
    document.getElementById('mainContent').style.display = 'block';

    // Configure UI based on role
    if (role === 'user') {
        document.getElementById('uploadSection').style.display = 'none';
        document.getElementById('exportBtn').style.display = 'none';
    }

    updateStatus(`${currentUsername} (${role}) connected`);

    // Log activity
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'ADD_ACTIVITY',
            entry: {
                timestamp: new Date().toISOString(),
                event: `user_role_set_${role}`,
                username: currentUsername,
                role: role
            }
        }));
    }
}

function updateStatus(message) {
    document.getElementById('statusIndicator').textContent = message;
}

function updateActivityLogDisplay() {
    const logEntries = document.getElementById('logEntries');
    logEntries.innerHTML = '';

    activityLog.slice(-50).reverse().forEach(entry => {
        const div = document.createElement('div');
        div.className = 'log-entry';
        div.innerHTML = `
      <div class="log-timestamp">${new Date(entry.timestamp).toLocaleString()}</div>
      <div><strong>${entry.username}:</strong> ${formatLogEvent(entry)}</div>
    `;
        logEntries.appendChild(div);
    });
}

function formatLogEvent(entry) {
    switch (entry.event) {
        case 'user_role_set_admin':
            return 'selected Admin role';
        case 'user_role_set_user':
            return 'selected User role';
        case 'file_uploaded':
            return `uploaded: ${entry.filename} (${entry.question_count} questions)`;
        case 'question_updated':
            return `updated question ${entry.question_index + 1}: ${entry.field}`;
        case 'choice_updated':
            return `updated choice in question ${entry.question_index + 1}`;
        case 'feedback_image_added':
            return `added image to question ${entry.question_index + 1}`;
        case 'feedback_image_removed':
            return `removed image from question ${entry.question_index + 1}`;
        case 'question_locked':
            return `locked question ${entry.question_index + 1}`;
        case 'question_unlocked':
            return `unlocked question ${entry.question_index + 1}`;
        case 'csv_exported':
            return 'exported CSV file';
        case 'log_cleared':
            return 'cleared activity log';
        default:
            return `${entry.event}`;
    }
}

function handleDragOver(e) {
    e.preventDefault();
    e.currentTarget.classList.add('dragover');
}

function handleDragLeave(e) {
    e.currentTarget.classList.remove('dragover');
}

function handleFileDrop(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('dragover');

    const files = e.dataTransfer.files;
    if (files.length > 0) {
        processFile(files[0]);
    }
}

function handleFileUpload(e) {
    const file = e.target.files[0];
    if (file) {
        processFile(file);
    }
}

function processFile(file) {
    if (!file.name.toLowerCase().endsWith('.txt')) {
        showAlert('Please upload a .txt file', 'error');
        return;
    }

    const reader = new FileReader();
    reader.onload = function (e) {
        const content = e.target.result;
        const parsedQuestions = parseMCQContent(content);

        if (parsedQuestions.length === 0) {
            showAlert('No valid MCQ questions found in the file', 'error');
            return;
        }

        // Send to server
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'ADD_QUESTIONS',
                questions: parsedQuestions,
                username: currentUsername,
                filename: file.name
            }));
        }
    };
    reader.readAsText(file);
}

function parseMCQContent(content) {
    const questions = [];
    const questionBlocks = content.trim().split(/\n(?=\d+\))/);

    for (const block of questionBlocks) {
        if (!block.trim()) continue;

        const lines = block.split('\n').map(line => line.trim()).filter(line => line);
        if (lines.length < 6) continue;

        // Extract question
        const questionMatch = lines[0].match(/^\d+\)\s*(.+)/);
        if (!questionMatch) continue;

        const questionText = questionMatch[1];

        // Extract choices
        const choices = [];
        const choicePattern = /^[a-d]\)\s*(.+)/;

        for (let i = 1; i <= 4; i++) {
            if (i < lines.length) {
                const choiceMatch = lines[i].match(choicePattern);
                if (choiceMatch) {
                    choices.push(choiceMatch[1]);
                }
            }
        }

        if (choices.length !== 4) continue;

        // Extract metadata
        let correctAnswer = '';
        let originalQuestion = '';
        let originalAnswer = '';

        for (let i = 5; i < lines.length; i++) {
            const line = lines[i];
            if (line.startsWith('i)')) {
                correctAnswer = line.substring(2).trim();
            } else if (line.startsWith('(1)')) {
                originalQuestion = line.substring(3).trim();
            } else if (line.startsWith('(a)')) {
                originalAnswer = line.substring(3).trim();
            }
        }

        questions.push({
            question: questionText,
            choices: choices,
            correct_answer: correctAnswer,
            original_question: originalQuestion,
            original_answer: originalAnswer,
            tag: '',
            feedback_images: []
        });
    }

    return questions;
}

function renderQuestions() {
    const container = document.getElementById('questionsContainer');
    container.innerHTML = '';

    questions.forEach((question, index) => {
        container.appendChild(createQuestionCard(question, index));
    });
    updateQuestionCount();
}

function createQuestionCard(question, index) {
    const card = document.createElement('div');
    card.className = 'question-card';
    card.id = `question-${index}`;

    const lockInfo = locks[index];
    const isLocked = !!lockInfo;
    const isLockedByMe = isLocked && lockInfo.clientId === myClientId;

    if (isLocked) {
        card.classList.add(isLockedByMe ? 'locked-by-me' : 'locked');
    }

    const lockIndicator = isLocked ?
        `<div class="lock-indicator ${isLockedByMe ? 'editing' : 'locked'}">
      ${isLockedByMe ? '🔒 You are editing' : `🔒 Locked by ${lockInfo.username}`}
    </div>` : '';

    const isEditable = currentRole && (!isLocked || isLockedByMe);
    const readonlyAttr = isEditable ? '' : 'readonly';
    const disabledAttr = isEditable ? '' : 'disabled';

    card.innerHTML = `
    ${lockIndicator}
    <div class="question-header">
      <div class="question-number">${index + 1}</div>
      <div style="flex: 1;">
        <div class="form-group">
          <label>Question:</label>
          <textarea class="form-control" rows="2" ${readonlyAttr}
            id="question-${index}-text">${question.question}</textarea>
        </div>
      </div>
    </div>
    
    <div class="choices-grid">
      ${question.choices.map((choice, choiceIndex) => `
        <div class="choice-group">
          <div class="choice-label">${String.fromCharCode(97 + choiceIndex)}</div>
          <input type="text" class="choice-input ${choice === question.correct_answer ? 'correct' : ''}" 
            value="${choice}" ${readonlyAttr}
            id="choice-${index}-${choiceIndex}">
        </div>
      `).join('')}
    </div>
    
    <div class="answer-section">
      <div class="form-group">
        <label>Correct Answer:</label>
        <select class="form-control" ${disabledAttr}
          id="correct-answer-${index}">
          ${question.choices.map(choice => `
            <option value="${choice}" ${choice === question.correct_answer ? 'selected' : ''}>${choice}</option>
          `).join('')}
        </select>
      </div>
    </div>
    
    <div class="metadata-section">
      <div class="form-group">
        <label>Original Question Context:</label>
        <input type="text" class="form-control" value="${question.original_question}" ${readonlyAttr}
          id="original-question-${index}">
      </div>
      <div class="form-group">
        <label>Original Answer:</label>
        <input type="text" class="form-control" value="${question.original_answer}" ${readonlyAttr}
          id="original-answer-${index}">
      </div>
      <div class="form-group">
        <label>Tag:</label>
        <input type="text" class="form-control" value="${question.tag}" ${readonlyAttr}
          id="tag-${index}">
      </div>
    </div>
    
    <div class="feedback-section">
      <label>Feedback Images:</label>
      ${isEditable ? `
        <div class="image-upload-area" id="image-upload-${index}">
          <p>📷 Click to add feedback image</p>
          <input type="file" id="imageInput-${index}" accept="image/*" style="display: none;">
        </div>
      ` : ''}
      <div class="feedback-images" id="feedbackImages-${index}">
        ${question.feedback_images.map((img, imgIndex) => `
          <div class="feedback-image">
            <img src="${img.image_data}" alt="Feedback image">
            ${isEditable ? `<button class="remove-image" data-index="${index}" data-img-index="${imgIndex}">×</button>` : ''}
          </div>
        `).join('')}
      </div>
    </div>
    
    <div class="controls" style="margin-top: 20px;">
      ${!isLocked ? `
        <button class="btn btn-primary" id="edit-btn-${index}">
          Edit Question
        </button>
      ` : isLockedByMe ? `
        <button class="btn btn-success" id="done-btn-${index}">
          Done Editing
        </button>
      ` : ''}
    </div>
  `;

    // Add event listeners
    if (isEditable) {
        // Text inputs
        card.querySelector(`#question-${index}-text`).addEventListener('change', (e) => {
            updateQuestion(index, 'question', e.target.value);
        });

        // Choice inputs
        question.choices.forEach((_, choiceIndex) => {
            card.querySelector(`#choice-${index}-${choiceIndex}`).addEventListener('change', (e) => {
                updateChoice(index, choiceIndex, e.target.value);
            });
        });

        // Correct answer
        card.querySelector(`#correct-answer-${index}`).addEventListener('change', (e) => {
            updateQuestion(index, 'correct_answer', e.target.value);
        });

        // Metadata
        card.querySelector(`#original-question-${index}`).addEventListener('change', (e) => {
            updateQuestion(index, 'original_question', e.target.value);
        });

        card.querySelector(`#original-answer-${index}`).addEventListener('change', (e) => {
            updateQuestion(index, 'original_answer', e.target.value);
        });

        card.querySelector(`#tag-${index}`).addEventListener('change', (e) => {
            updateQuestion(index, 'tag', e.target.value);
        });

        // Image upload
        if (card.querySelector(`#image-upload-${index}`)) {
            card.querySelector(`#image-upload-${index}`).addEventListener('click', () => {
                uploadFeedbackImage(index);
            });

            card.querySelector(`#imageInput-${index}`).addEventListener('change', (e) => {
                handleImageUpload(index, e);
            });
        }

        // Remove image buttons
        card.querySelectorAll('.remove-image').forEach(btn => {
            btn.addEventListener('click', () => {
                removeFeedbackImage(
                    parseInt(btn.dataset.index),
                    parseInt(btn.dataset.imgIndex)
                );
            });
        });
    }

    // Edit button
    if (card.querySelector(`#edit-btn-${index}`)) {
        card.querySelector(`#edit-btn-${index}`).addEventListener('click', () => {
            lockQuestion(index);
        });
    }

    // Done button
    if (card.querySelector(`#done-btn-${index}`)) {
        card.querySelector(`#done-btn-${index}`).addEventListener('click', () => {
            unlockQuestion(index);
        });
    }

    return card;
}

function lockQuestion(index) {
    if (!currentUsername) {
        showAlert('Please enter your username first', 'error');
        showUsernameModal();
        return;
    }

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'LOCK_QUESTION',
            index,
            clientId: myClientId,
            username: currentUsername
        }));
    }
}

function unlockQuestion(index) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'UNLOCK_QUESTION',
            index,
            clientId: myClientId,
            username: currentUsername
        }));
    }
}

function updateQuestion(index, field, value) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        // Create updated question object
        const updatedQuestion = {
            ...questions[index],
            [field]: value
        };

        ws.send(JSON.stringify({
            type: 'UPDATE_QUESTION',
            index,
            question: updatedQuestion,
            clientId: myClientId,
            username: currentUsername,
            field
        }));
    }
}

function updateChoice(index, choiceIndex, value) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        // Create updated question object
        const updatedQuestion = { ...questions[index] };
        updatedQuestion.choices[choiceIndex] = value;

        // Update correct answer if needed
        if (questions[index].correct_answer === questions[index].choices[choiceIndex]) {
            updatedQuestion.correct_answer = value;
        }

        ws.send(JSON.stringify({
            type: 'UPDATE_QUESTION',
            index,
            question: updatedQuestion,
            clientId: myClientId,
            username: currentUsername,
            field: `choice_${choiceIndex}`
        }));
    }
}

function uploadFeedbackImage(index) {
    document.getElementById(`imageInput-${index}`).click();
}

function handleImageUpload(index, e) {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        showAlert('Please select a valid image file', 'error');
        return;
    }

    const reader = new FileReader();
    reader.onload = function (e) {
        const imageData = e.target.result;

        if (ws && ws.readyState === WebSocket.OPEN) {
            // Create updated question object
            const updatedQuestion = { ...questions[index] };
            updatedQuestion.feedback_images = [
                ...updatedQuestion.feedback_images,
                { image_data: imageData, filename: file.name }
            ];

            ws.send(JSON.stringify({
                type: 'UPDATE_QUESTION',
                index,
                question: updatedQuestion,
                clientId: myClientId,
                username: currentUsername,
                field: 'feedback_image'
            }));
        }
    };
    reader.readAsDataURL(file);
}

function removeFeedbackImage(index, imageIndex) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        // Create updated question object
        const updatedQuestion = { ...questions[index] };
        updatedQuestion.feedback_images.splice(imageIndex, 1);

        ws.send(JSON.stringify({
            type: 'UPDATE_QUESTION',
            index,
            question: updatedQuestion,
            clientId: myClientId,
            username: currentUsername,
            field: 'remove_feedback_image'
        }));
    }
}

function updateQuestionCount() {
    document.getElementById('questionCount').textContent = `${questions.length} questions loaded`;
}

function exportCSV() {
    if (questions.length === 0) {
        showAlert('No questions to export', 'error');
        return;
    }

    const csvRows = [];

    // Header row
    csvRows.push([
        'question',
        'choices',
        'answer',
        'original_question',
        'original_answer',
        'tag',
        'feedback'
    ]);

    // Data rows
    questions.forEach(question => {
        const choicesStr = JSON.stringify(question.choices);
        const feedbackFilenames = question.feedback_images.map(img => img.filename);
        const feedbackStr = JSON.stringify(feedbackFilenames);

        csvRows.push([
            question.question,
            choicesStr,
            question.correct_answer,
            question.original_question,
            question.original_answer,
            question.tag,
            feedbackStr
        ]);
    });

    // Convert to CSV string
    const csvContent = csvRows.map(row => {
        return row.map(cell => {
            const escapedCell = String(cell).replace(/"/g, '""');
            if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
                return `"${escapedCell}"`;
            }
            return escapedCell;
        }).join(',');
    }).join('\n');

    // Download CSV
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mcq_questions.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    // Log activity
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'ADD_ACTIVITY',
            entry: {
                timestamp: new Date().toISOString(),
                event: 'csv_exported',
                username: currentUsername
            }
        }));
    }

    showAlert('CSV file downloaded successfully', 'success');
}

function toggleActivityLog() {
    const log = document.getElementById('activityLog');
    log.classList.toggle('show');
    updateActivityLogDisplay();
}

function clearActivityLog() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'CLEAR_LOG'
        }));
    }
}

function showAlert(message, type) {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type}`;
    alertDiv.textContent = message;

    const container = document.getElementById('mainContent');
    container.insertBefore(alertDiv, container.firstChild);

    setTimeout(() => {
        alertDiv.remove();
    }, 5000);
}

// Initialize the application when the page loads
window.addEventListener('load', init);