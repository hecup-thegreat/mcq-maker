// Global variables
let currentRole = null;
let currentUsername = "";
let collections = [
    {
        name: "Default",
        metadata: { year: "", type: "", unit: "" },
        questions: [],
        locks: {},
        activityLog: []
    }
];
let currentCollectionIndex = 0;
let myClientId = 'client_' + Math.random().toString(36).substr(2, 9);
let ws = null;
let reconnectAttempts = 0;
let activeFilter = null;
const APP_STATE_KEY = 'mcq_app_state';
let lockedQuestions = [];
let lastServerUpdate = 0; // Timestamp of last server update

// Initialize the application
function init() {
    // Try to load saved state
    const stateLoaded = loadStateFromLocalStorage();

    setupEventListeners();
    connectWebSocket();

    if (stateLoaded) {
        updateStatus('Restored previous session');
        document.getElementById('roleSelection').style.display = 'none';
        document.getElementById('mainContent').style.display = 'block';

        if (currentRole === 'user') {
            document.getElementById('uploadSection').style.display = 'none';
            document.getElementById('exportBtn').style.display = 'none';
        }

        renderCollectionTabs();
        renderQuestions();
        updateQuestionCount();
        updateActivityLogDisplay();
        highlightMissingFields();
    } else {
        updateStatus('Ready');
        showUsernameModal();
        renderCollectionTabs();
    }
}

function showUsernameModal() {
    const modal = document.getElementById('usernameModal');

    // Pre-fill username if available
    if (currentUsername) {
        document.getElementById('usernameInput').value = currentUsername;
    }

    modal.classList.add('show');

    document.getElementById('confirmUsername').addEventListener('click', () => {
        const username = document.getElementById('usernameInput').value.trim();
        if (username) {
            currentUsername = username;
            modal.classList.remove('show');
            updateStatus(`Welcome, ${username}!`);
            saveStateToLocalStorage();
        }
    });
}

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
    ws = new WebSocket(`${protocol}${window.location.host}`);

    ws.onopen = () => {
        updateStatus('Connected to server');
        reconnectAttempts = 0;

        // Request current server state
        ws.send(JSON.stringify({
            type: 'REQUEST_STATE',
            clientId: myClientId,
            lastUpdate: lastServerUpdate
        }));
    };

    ws.onmessage = (e) => {
        try {
            const data = JSON.parse(e.data);

            if (data.type === 'FULL_STATE') {
                // Full state synchronization
                lastServerUpdate = data.timestamp;
                collections = data.state.collections || [];
                currentCollectionIndex = data.state.currentCollectionIndex || 0;

                saveStateToLocalStorage();
                renderCollectionTabs();
                renderQuestions();
                updateQuestionCount();
                updateActivityLogDisplay();
                highlightMissingFields();
            }
            else if (data.type === 'STATE_UPDATE') {
                // Handle incremental updates
                lastServerUpdate = data.timestamp;

                if (data.collectionIndex !== undefined) {
                    const collection = collections[data.collectionIndex];

                    if (data.action === 'ADD_QUESTIONS') {
                        collection.questions.push(...data.questions);
                    }
                    else if (data.action === 'UPDATE_QUESTION') {
                        collection.questions[data.index] = data.question;
                    }
                    else if (data.action === 'DELETE_QUESTION') {
                        collection.questions.splice(data.index, 1);
                    }
                    else if (data.action === 'LOCK_QUESTION') {
                        collection.locks[data.index] = data.lockInfo;
                    }
                    else if (data.action === 'UNLOCK_QUESTION') {
                        delete collection.locks[data.index];
                    }
                    else if (data.action === 'ADD_ACTIVITY') {
                        collection.activityLog.push(data.entry);
                    }
                }

                saveStateToLocalStorage();
                renderCollectionTabs();
                renderQuestions();
                updateQuestionCount();
                updateActivityLogDisplay();
                highlightMissingFields();
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
        updateStatus(`Disconnected. Reconnecting in ${Math.min(10, reconnectAttempts)} seconds...`);
        const delay = Math.min(10000, reconnectAttempts * 1000);
        setTimeout(connectWebSocket, delay);
        reconnectAttempts++;
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

    // Upload option change
    document.querySelectorAll('input[name="uploadOption"]').forEach(radio => {
        radio.addEventListener('change', () => {
            const newCollectionDiv = document.getElementById('newCollectionMetadata');
            newCollectionDiv.style.display =
                document.querySelector('input[name="uploadOption"]:checked').value === 'new'
                    ? 'block'
                    : 'none';
        });
    });

    // Filter event listeners
    document.getElementById('applyFilterBtn').addEventListener('click', applyFilter);
    document.getElementById('clearFilterBtn').addEventListener('click', clearFilter);
}

function renderCollectionTabs() {
    const tabsContainer = document.getElementById('collectionTabs');
    tabsContainer.innerHTML = '';

    collections.forEach((collection, index) => {
        const tabContainer = document.createElement('div');
        tabContainer.className = `tab-container ${index === currentCollectionIndex ? 'active' : ''}`;
        tabContainer.dataset.index = index;

        const tabButton = document.createElement('button');
        tabButton.className = 'tab-button';
        tabButton.textContent = collection.name;
        tabButton.addEventListener('click', () => {
            switchCollection(index);
        });

        // Only show delete button if admin and there's more than one collection
        if (currentRole === 'admin' && collections.length > 1) {
            const deleteButton = document.createElement('button');
            deleteButton.className = 'delete-tab';
            deleteButton.innerHTML = '×';
            deleteButton.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteCollection(index);
            });
            tabContainer.appendChild(deleteButton);
        }

        tabContainer.insertBefore(tabButton, tabContainer.firstChild);
        tabsContainer.appendChild(tabContainer);
    });
}

function switchCollection(index) {
    // Unlock any questions in the current collection before switching
    const currentCollection = getCurrentCollection();
    Object.keys(currentCollection.locks).forEach(questionIndex => {
        const lock = currentCollection.locks[questionIndex];
        if (lock.clientId === myClientId) {
            unlockQuestion(parseInt(questionIndex));
        }
    });

    currentCollectionIndex = index;
    renderCollectionTabs();
    renderQuestions();
    updateQuestionCount();
    updateActivityLogDisplay();
    updateStatus(`Switched to collection: ${collections[index].name}`);
    clearFilter();

    saveStateToLocalStorage();
}

function deleteCollection(index) {
    if (collections.length <= 1) {
        showAlert('Cannot delete the last collection', 'error');
        return;
    }

    if (confirm(`Are you sure you want to delete "${collections[index].name}" collection?`)) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'DELETE_COLLECTION',
                collectionIndex: index,
                username: currentUsername
            }));
        }

        // Remove locally immediately
        collections.splice(index, 1);
        if (currentCollectionIndex >= index) {
            currentCollectionIndex = Math.max(0, currentCollectionIndex - 1);
        }

        renderCollectionTabs();
        renderQuestions();
        updateQuestionCount();
        updateActivityLogDisplay();

        saveStateToLocalStorage();
    }
}

function getCurrentCollection() {
    return collections[currentCollectionIndex];
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
            },
            collectionIndex: currentCollectionIndex
        }));
    }

    saveStateToLocal极狐Storage();
}

function updateStatus(message) {
    document.getElementById('statusIndicator').textContent = message;
}

function updateActivityLogDisplay() {
    const logEntries = document.getElementById('logEntries');
    logEntries.innerHTML = '';

    const currentCollection = getCurrentCollection();
    currentCollection.activityLog.slice(-50).reverse().forEach(entry => {
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
        case 'question_deleted':
            return `deleted question ${entry.question_index + 1}`;
        case 'csv_exported':
            return 'exported CSV file';
        case 'log_cleared':
            return 'cleared activity log';
        case 'collection_created':
            return `created new collection: ${entry.collectionName}`;
        case 'collection_deleted':
            return `deleted collection: ${entry.collectionName}`;
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
    // Reset file input to allow uploading same file again
    e.target.value = '';
}

function processFile(file) {
    if (!file.name.toLowerCase().endsWith('.txt')) {
        showAlert('Please upload a .txt file', 'error');
        return;
    }

    const uploadOption = document.querySelector('input[name="uploadOption"]:checked').value;
    const isNewCollection = uploadOption === 'new';

    if (isNewCollection) {
        const year = document.getElementById('collectionYear').value.trim();
        const type = document.getElementById('collectionType').value.trim();
        const unit = document.getElementById('collectionUnit').value.trim();

        if (!year || !type || !unit) {
            showAlert('Please fill all metadata fields for new collection', 'error');
            return;
        }
    }

    const reader = new FileReader();
    reader.onload = function (e) {
        const content = e.target.result;
        let parsedQuestions;

        try {
            parsedQuestions = parseMCQContent(content);
        } catch (error) {
            console.error('Error parsing file:', error);
            showAlert('Error parsing file content. Please check the format.', 'error');
            return;
        }

        if (parsedQuestions.length === 0) {
            showAlert('No valid MCQ questions found in the file', 'error');
            return;
        }

        // Send to server
        if (ws && ws.readyState === WebSocket.OPEN) {
            const payload = {
                type: 'STATE_UPDATE',
                action: isNewCollection ? 'CREATE_COLLECTION' : 'ADD_QUESTIONS',
                questions: parsedQuestions,
                username: currentUsername,
                filename: file.name,
                clientId: myClientId,
                collectionIndex: isNewCollection ? -1 : currentCollectionIndex
            };

            if (isNewCollection) {
                payload.metadata = {
                    year: document.getElementById('collectionYear').value.trim(),
                    type: document.getElementById('collectionType').value.trim(),
                    unit: document.getElementById('collectionUnit').value.trim()
                };
            }

            ws.send(JSON.stringify(payload));
            showAlert(`File uploaded successfully to ${isNewCollection ? 'new collection' : 'current collection'}!`, 'success');
        } else {
            // Add directly to local state if not connected
            if (isNewCollection) {
                collections.push({
                    name: `${document.getElementById('collectionYear').value.trim()} ${document.getElementById('collectionType').value.trim()}`,
                    metadata: {
                        year: document.getElementById('collectionYear').value.trim(),
                        type: document.getElementById('collectionType').value.trim(),
                        unit: document.getElementById('collectionUnit').value.trim()
                    },
                    questions: parsedQuestions,
                    locks: {},
                    activityLog: []
                });
                currentCollectionIndex = collections.length - 1;
            } else {
                getCurrentCollection().questions.push(...parsedQuestions);
            }

            renderCollectionTabs();
            renderQuestions();
            updateQuestionCount();

            showAlert(`File uploaded locally to ${is极狐Collection ? 'new collection' : 'current collection'}!`, 'success');
        }

        saveStateToLocalStorage();
    };

    reader.onerror = function () {
        showAlert('Error reading file', 'error');
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

    const currentCollection = getCurrentCollection();
    currentCollection.questions.forEach((question, index) => {
        container.appendChild(createQuestionCard(question, index));
    });
    updateQuestionCount();
    highlightMissingFields();
}

function createQuestionCard(question, index) {
    const card = document.createElement('div');
    card.className = 'question-card';
    card.id = `question-${index}`;

    const currentCollection = getCurrentCollection();
    const lockInfo = currentCollection.locks[index];
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
    const isDeletable = currentRole === 'admin' && (!isLocked || isLockedByMe);

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
      <div class="question-top-right">
        ${isDeletable ? `
          <button class="delete-question-btn" id="delete-btn-${index}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
            Delete
          </button>
        ` : ''}
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
      <极狐div class="form-group">
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

    // Delete button
    if (card.querySelector(`#delete-btn-${index}`)) {
        card.querySelector(`#delete-btn-${index}`).addEventListener('click', () => {
            deleteQuestion(index);
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

    // Track locked question
    lockedQuestions.push({
        collectionIndex: currentCollectionIndex,
        questionIndex: index
    });

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'LOCK_QUESTION',
            index,
            clientId: myClientId,
            username: currentUsername,
            collectionIndex: currentCollectionIndex
        }));
    }

    // Update UI immediately
    const currentCollection = getCurrentCollection();
    currentCollection.locks[index] = {
        clientId: myClientId,
        username: currentUsername,
        timestamp: Date.now()
    };

    renderQuestions();
    saveStateToLocalStorage();
}

function unlockQuestion(index) {
    // Remove from locked questions
    lockedQuestions = lockedQuestions.filter(q =>
        !(q.collectionIndex === currentCollectionIndex && q.questionIndex === index)
    );

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'UNLOCK_QUESTION',
            index,
            clientId: myClientId,
            username: currentUsername,
            collectionIndex: currentCollectionIndex
        }));
    }

    // Update UI immediately
    const currentCollection = getCurrentCollection();
    delete currentCollection.locks[index];

    renderQuestions();
    saveStateToLocalStorage();
}

function deleteQuestion(index) {
    if (!currentUsername) {
        showAlert('Please enter your username first', 'error');
        showUsernameModal();
        return;
    }

    if (confirm('Are you sure you want to delete this question? This action cannot be undone.')) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'DELETE_QUESTION',
                index,
                clientId: myClientId,
                username: currentUsername,
                collectionIndex: currentCollectionIndex
            }));
        }

        // Remove locally immediately
        const currentCollection = getCurrentCollection();
        currentCollection.questions.splice(index, 1);

        // Remove lock if exists
        if (currentCollection.locks[index]) {
            delete currentCollection.locks[index];
        }

        renderQuestions();
        saveStateToLocalStorage();
    }
}

function updateQuestion(index, field, value) {
    const currentCollection = getCurrentCollection();
    currentCollection.questions[index][field] = value;

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'STATE_UPDATE',
            action: 'UPDATE_QUESTION',
            collectionIndex: currentCollectionIndex,
            index,
            field,
            value,
            clientId: myClientId,
            username: currentUsername,
            question: currentCollection.questions[index]
        }));
    }

    saveStateToLocalStorage();
    highlightMissingFields();
}

function updateChoice(index, choiceIndex, value) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        // Create updated question object
        const currentCollection = getCurrentCollection();
        const updatedQuestion = { ...currentCollection.questions[index] };
        updatedQuestion.choices[choiceIndex] = value;

        // Update correct answer if needed
        if (currentCollection.questions[index].correct_answer === currentCollection.questions[index].choices[choiceIndex]) {
            updatedQuestion.correct_answer = value;
        }

        ws.send(JSON.stringify({
            type: 'UPDATE_QUESTION',
            index,
            question: updatedQuestion,
            clientId: myClientId,
            username: currentUsername,
            field: `choice_${choiceIndex}`,
            collectionIndex: currentCollectionIndex
        }));
    }

    // Update locally immediately
    const currentCollection = getCurrentCollection();
    currentCollection.questions[index].choices[choiceIndex] = value;

    // Update correct answer if needed
    if (currentCollection.questions[index].correct_answer === currentCollection.questions[index].choices[choiceIndex]) {
        currentCollection.questions[index].correct_answer = value;
    }

    saveStateToLocalStorage();
    highlightMissingFields();
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

        // Update locally immediately
        const currentCollection = getCurrentCollection();
        const updatedQuestion = { ...currentCollection.questions[index] };
        updatedQuestion.feedback_images = [
            ...updatedQuestion.feedback_images,
            { image_data: imageData, filename: file.name }
        ];
        currentCollection.questions[index] = updatedQuestion;

        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'UPDATE_QUESTION',
                index,
                question: updatedQuestion,
                clientId: myClientId,
                username: currentUsername,
                field: 'feedback_image',
                collectionIndex: currentCollectionIndex
            }));
        }

        renderQuestions();
        saveStateToLocalStorage();
        highlightMissingFields();
    };
    reader.readAsDataURL(file);
}

function removeFeedbackImage(index, imageIndex) {
    // Update locally immediately
    const currentCollection = getCurrentCollection();
    const updatedQuestion = { ...currentCollection.questions[index] };
    updatedQuestion.feedback_images.splice(imageIndex, 1);
    currentCollection.questions[index] = updatedQuestion;

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'UPDATE_QUESTION',
            index,
            question: updatedQuestion,
            clientId: myClientId,
            username: currentUsername,
            field: 'remove_feedback_image',
            collectionIndex: currentCollectionIndex
        }));
    }

    renderQuestions();
    saveStateToLocalStorage();
    highlightMissingFields();
}

function updateQuestionCount() {
    const currentCollection = getCurrentCollection();
    document.getElementById('questionCount').textContent =
        `${currentCollection.questions.length} questions loaded`;
}

function exportCSV() {
    const currentCollection = getCurrentCollection();
    if (currentCollection.questions.length === 0) {
        showAlert('No questions to export', 'error');
        return;
    }

    const csvRows = [];

    // Header row
    csvRows.push([
        'year',
        'type',
        'unit',
        'question',
        'choices',
        'answer',
        'original_question',
        'original_answer',
        'tag',
        'feedback'
    ]);

    // Data rows
    currentCollection.questions.forEach(question => {
        const choicesStr = JSON.stringify(question.choices);
        const feedbackFilenames = question.feedback_images.map(img => img.filename);
        const feedbackStr = JSON.stringify(feedbackFilenames);

        csvRows.push([
            currentCollection.metadata.year,
            currentCollection.metadata.type,
            currentCollection.metadata.unit,
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
            },
            collectionIndex: currentCollectionIndex
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
            type: 'CLEAR_LOG',
            collectionIndex: currentCollectionIndex
        }));
    }

    // Clear locally immediately
    const currentCollection = getCurrentCollection();
    currentCollection.activityLog = [];
    updateActivityLogDisplay();

    saveStateToLocalStorage();
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

function saveStateToLocalStorage() {
    const state = {
        collections,
        currentCollectionIndex,
        currentUsername,
        currentRole,
        lockedQuestions,
        myClientId,
        lastServerUpdate
    };
    localStorage.setItem(APP_STATE_KEY, JSON.stringify(state));
}

function loadStateFromLocalStorage() {
    const savedState = localStorage.getItem(APP_STATE_KEY);
    if (savedState) {
        try {
            const state = JSON.parse(savedState);
            collections = state.collections || collections;
            currentCollectionIndex = state.currentCollectionIndex || 0;
            currentUsername = state.currentUsername || "";
            currentRole = state.currentRole || null;
            lockedQuestions = state.lockedQuestions || [];
            myClientId = state.myClientId || myClientId;
            lastServerUpdate = state.lastServerUpdate || 0;

            return true;
        } catch (e) {
            console.error('Error loading saved state:', e);
        }
    }
    return false;
}

function applyFilter() {
    const missingTag = document.getElementById('filter-missing-tag').checked;
    const missingFeedback = document.getElementById('filter-missing-feedback').checked;
    const bothMissing = document.getElementById('filter-both-missing').checked;

    if (bothMissing) {
        activeFilter = 'both';
    } else if (missingTag && missingFeedback) {
        activeFilter = 'both';
    } else if (missingTag) {
        activeFilter = 'tag';
    } else if (missingFeedback) {
        activeFilter = 'feedback';
    } else {
        activeFilter = null;
    }

    highlightMissingFields();

    // Update button states
    document.getElementById('applyFilterBtn').classList.toggle('active', activeFilter !== null);
    document.getElementById('clearFilterBtn').classList.toggle('active', activeFilter !== null);
}

function clearFilter() {
    document.getElementById('filter-missing-tag').checked = false;
    document.getElementById('filter-missing-feedback').checked = false;
    document.getElementById('filter-both-missing').checked = false;
    activeFilter = null;

    // Remove all highlighting
    const questions = document.querySelectorAll('.question-card');
    questions.forEach(card => {
        card.querySelectorAll('.missing-field').forEach(el => {
            el.classList.remove('missing-field');
        });
        card.classList.remove('has-missing');
    });

    // Update button states
    document.getElementById('applyFilterBtn').classList.remove('active');
    document.getElementById('clearFilterBtn').classList.remove('active');
}

function highlightMissingFields() {
    const currentCollection = getCurrentCollection();

    // First remove all highlighting
    const questions = document.querySelectorAll('.question-card');
    questions.forEach(card => {
        card.querySelectorAll('.missing-field').forEach(el => {
            el.classList.remove('missing-field');
        });
        card.classList.remove('has-missing');
    });

    if (!activeFilter) return;

    // Apply new highlighting
    currentCollection.questions.forEach((question, index) => {
        const card = document.getElementById(`question-${index}`);
        if (!card) return;

        const tagMissing = question.tag.trim() === '';
        const feedbackMissing = question.feedback_images.length === 0;

        let shouldHighlight = false;

        switch (activeFilter) {
            case 'tag':
                if (tagMissing) {
                    card.querySelector('#tag-' + index).classList.add('missing-field');
                    shouldHighlight = true;
                }
                break;
            case 'feedback':
                if (feedbackMissing) {
                    card.querySelector('.feedback-section').classList.add('missing-field');
                    shouldHighlight = true;
                }
                break;
            case 'both':
                if (tagMissing && feedbackMissing) {
                    card.querySelector('#tag-' + index).classList.add('missing-field');
                    card.querySelector('.feedback-section').classList.add('missing-field');
                    shouldHighlight = true;
                } else if (tagMissing) {
                    card.querySelector('#tag-' + index).classList.add('missing-field');
                    shouldHighlight = true;
                } else if (feedbackMissing) {
                    card.querySelector('.feedback-section').classList.add('missing-field');
                    shouldHighlight = true;
                }
                break;
        }

        // Add card highlight if any field is missing
        if (shouldHighlight) {
            card.classList.add('has-missing');
        }
    });
}

function unlockAllQuestions() {
    // Unlock via WebSocket if connected
    if (ws && ws.readyState === WebSocket.OPEN) {
        lockedQuestions.forEach(lock => {
            ws.send(JSON.stringify({
                type: 'UNLOCK_QUESTION',
                index: lock.questionIndex,
                client极狐Id: myClientId,
                username: currentUsername,
                collectionIndex: lock.collectionIndex
            }));
        });
    }

    // Unlock locally
    lockedQuestions.forEach(lock => {
        const collection = collections[lock.collectionIndex];
        if (collection && collection.locks[lock.questionIndex]) {
            delete collection.locks[lock.questionIndex];
        }
    });

    lockedQuestions = [];
    saveStateToLocalStorage();
    renderQuestions();
}

// Handle page/tab closing
window.addEventListener('beforeunload', function () {
    unlockAllQuestions();
});

// Handle page visibility changes
document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
        unlockAllQuestions();
    }
});

// Initialize the application when the page loads
window.addEventListener('load', init);