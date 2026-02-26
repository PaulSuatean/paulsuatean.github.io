// Dashboard Logic

let currentUser = null;
let trees = [];
let treeToDelete = null;
let wizardCenterNameTouched = false;
let currentWizardStep = 1;
let isLocalGuestMode = false;
const AUTH_STATE_TIMEOUT_MS = 10000;
const TREE_LOAD_TIMEOUT_MS = 12000;
const LOCAL_GUEST_TREE_KEY = 'ancestrio:guest-tree:v1';

function showErrorText(errorEl, message) {
  if (!errorEl) return;
  if (message) errorEl.textContent = message;
  window.AncestrioDomDisplay.show(errorEl);
}

function notifyUser(message, type = 'error', options = {}) {
  if (window.AncestrioRuntime && typeof window.AncestrioRuntime.notify === 'function') {
    window.AncestrioRuntime.notify(message, type, options);
    return;
  }
  if (type === 'error') {
    console.error(message);
  } else {
    console.warn(message);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  // Theme toggle
  window.AncestrioTheme?.initThemeToggle();

  // Event listeners
  document.getElementById('logoutBtn').addEventListener('click', logout);
  document.getElementById('createTreeBtn').addEventListener('click', showCreateModal);
  document.getElementById('createTreeBtnEmpty')?.addEventListener('click', showCreateModal);
  document.getElementById('closeCreateModal').addEventListener('click', hideCreateModal);
  document.getElementById('closeDeleteModal').addEventListener('click', hideDeleteModal);
  document.getElementById('cancelDeleteBtn').addEventListener('click', hideDeleteModal);
  document.getElementById('confirmDeleteBtn').addEventListener('click', confirmDelete);
  
  setupWizardEventListeners();

  const urlParams = new URLSearchParams(window.location.search);
  isLocalGuestMode = localStorage.getItem('guestMode') === 'true' || urlParams.get('guest') === '1';

  if (isLocalGuestMode) {
    localStorage.setItem('guestMode', 'true');
    currentUser = {
      uid: 'guest-local',
      isAnonymous: true,
      displayName: 'Guest',
      email: ''
    };
    configureGuestDashboardUI();
    updateDashboardTitle(currentUser);
    await loadTrees();
    if (!hasStoredGuestTree()) {
      showCreateModal();
    }
    return;
  }

  localStorage.removeItem('guestMode');

  // Initialize Firebase
  if (!initializeFirebase()) {
    window.location.href = 'auth.html';
    return;
  }

  // Check authentication
  let authStateResolved = false;
  const authStateTimeoutId = window.setTimeout(() => {
    if (authStateResolved) return;
    console.error('Authentication state check timed out');
    window.AncestrioDomDisplay.hide('loadingState');
    showDashboardStatus('Authentication check timed out. Refresh this page and sign in again.');
  }, AUTH_STATE_TIMEOUT_MS);

  auth.onAuthStateChanged(
    async (user) => {
      authStateResolved = true;
      window.clearTimeout(authStateTimeoutId);
      if (user) {
        currentUser = user;
        updateDashboardTitle(currentUser);
        await loadTrees();
      } else {
        window.location.href = 'auth.html';
      }
    },
    (error) => {
      authStateResolved = true;
      window.clearTimeout(authStateTimeoutId);
      console.error('Auth state listener error:', error);
      window.AncestrioDomDisplay.hide('loadingState');
      showDashboardStatus('Authentication failed. Please sign in again.');
    }
  );
});

function setupWizardEventListeners() {
  document.getElementById('wizardBackBtn')?.addEventListener('click', () => {
    if (currentWizardStep <= 1) {
      hideCreateModal();
      return;
    }
    goToStep(currentWizardStep - 1);
  });

  document.getElementById('wizardNextBtn')?.addEventListener('click', (event) => {
    if (currentWizardStep === 2 && !validateStep2()) return;
    if (currentWizardStep >= 5) {
      createTreeFromWizard(event);
      return;
    }
    goToStep(currentWizardStep + 1);
  });

  document.getElementById('treeName').addEventListener('input', () => clearFieldError('treeName', 'treeNameError'));
  ['centralPersonFirstName', 'centralPersonLastName'].forEach((fieldId) => {
    document.getElementById(fieldId).addEventListener('input', () => {
      wizardCenterNameTouched = true;
      syncCentralNameValidationState();
      updateWizardPerspective();
    });
  });

  document.querySelectorAll('input[name="centerMode"]').forEach((input) => {
    input.addEventListener('change', updateWizardPerspective);
  });
  document.querySelectorAll('input[name="enableBirthdays"]').forEach((input) => {
    input.addEventListener('change', () => {
      updateBirthdaysPreferenceForWizard();
      updateWizardPerspective();
    });
  });
  document.querySelectorAll('input[name="enableGlobeCountries"]').forEach((input) => {
    input.addEventListener('change', updateWizardPerspective);
  });

  document.getElementById('creatorRelationship').addEventListener('change', updateRelationshipOtherVisibility);

  document.querySelectorAll('input[name="hasSiblings"]').forEach((input) => {
    input.addEventListener('change', updateSiblingsBlock);
  });
  document.querySelectorAll('input[name="hasChildren"]').forEach((input) => {
    input.addEventListener('change', updateChildrenBlock);
  });
  document.querySelectorAll('input[name="hasGrandchildren"]').forEach((input) => {
    input.addEventListener('change', updateGrandchildrenBlock);
  });

  document.getElementById('birthdateInfoBtn')?.addEventListener('click', toggleBirthdateInfo);
  setupBirthdateInputMasks();
  updateBirthdaysPreferenceForWizard();
}

function getWizardCenterMode() {
  const mode = document.querySelector('input[name="centerMode"]:checked');
  return mode ? mode.value : 'me';
}

function areWizardBirthdaysEnabled() {
  const option = document.querySelector('input[name="enableBirthdays"]:checked');
  return option ? option.value !== 'no' : true;
}

function areWizardGlobeCountriesEnabled() {
  const option = document.querySelector('input[name="enableGlobeCountries"]:checked');
  return option ? option.value !== 'no' : true;
}

function splitFullName(fullName) {
  const cleaned = sanitizeText(fullName).replace(/\s+/g, ' ');
  if (!cleaned) {
    return { firstName: '', lastName: '' };
  }
  const parts = cleaned.split(' ');
  return {
    firstName: parts.shift() || '',
    lastName: parts.join(' ')
  };
}

function combineNames(firstName, lastName) {
  const first = sanitizeText(firstName);
  const last = sanitizeText(lastName);
  return `${first} ${last}`.trim();
}

function updateWizardPerspective() {
  const mode = getWizardCenterMode();
  const isSelf = mode === 'me';
  const birthdaysEnabled = areWizardBirthdaysEnabled();
  const defaultName = getCurrentUserName(currentUser) || 'Family Member';
  const defaultNameParts = splitFullName(defaultName);
  const centralFirstNameInput = document.getElementById('centralPersonFirstName');
  const centralLastNameInput = document.getElementById('centralPersonLastName');

  if (!wizardCenterNameTouched) {
    centralFirstNameInput.value = isSelf ? defaultNameParts.firstName : '';
    centralLastNameInput.value = isSelf ? defaultNameParts.lastName : '';
  }

  document.getElementById('step2Heading').textContent = isSelf ? 'About You' : 'About the Central Person';
  document.getElementById('step2Subtitle').textContent = isSelf
    ? 'Add tree details and your information.'
    : 'Add tree details and the central person information.';
  document.getElementById('centralNameLabel').innerHTML = isSelf
    ? 'Your full name <span class="required">*</span>'
    : 'Central person full name <span class="required">*</span>';

  document.getElementById('step3Heading').textContent = isSelf ? 'Your Parents' : 'Their Parents';
  if (birthdaysEnabled) {
    document.getElementById('step3Subtitle').textContent = isSelf
      ? 'Add your parents and birthdates (optional).'
      : 'Add this person\'s parents and birthdates (optional).';
  } else {
    document.getElementById('step3Subtitle').textContent = isSelf
      ? 'Add your parents (you can skip unknown information).'
      : 'Add this person\'s parents (you can skip unknown information).';
  }
  document.getElementById('fatherNameLabel').textContent = isSelf
    ? 'Your father\'s full name'
    : 'Father\'s full name';
  document.getElementById('fatherBirthdateLabel').textContent = isSelf
    ? 'Your father\'s birthdate'
    : 'Father\'s birthdate';
  document.getElementById('motherNameLabel').textContent = isSelf
    ? 'Your mother\'s full name'
    : 'Mother\'s full name';
  document.getElementById('motherBirthdateLabel').textContent = isSelf
    ? 'Your mother\'s birthdate'
    : 'Mother\'s birthdate';

  document.getElementById('step4Heading').textContent = isSelf ? 'Your Siblings' : 'Their Siblings';
  document.getElementById('step4Subtitle').textContent = isSelf
    ? 'Add siblings if available.'
    : 'Add this person\'s siblings if available.';
  document.getElementById('siblingsQuestion').textContent = isSelf
    ? 'Do you have brothers or sisters?'
    : 'Does this person have brothers or sisters?';
  document.getElementById('siblingsListLabel').textContent = isSelf
    ? 'Add siblings'
    : 'Add siblings';

  document.getElementById('step5Heading').textContent = isSelf ? 'Your Partner, Children, and Grandchildren' : 'Their Partner, Children, and Grandchildren';
  document.getElementById('step5Subtitle').textContent = isSelf
    ? 'Add partner, children, and grandchildren details.'
    : 'Add this person\'s partner, children, and grandchildren details.';
  document.getElementById('partnerNameLabel').textContent = isSelf
    ? 'Your partner or spouse name'
    : 'Partner or spouse name';
  document.getElementById('partnerBirthdateLabel').textContent = isSelf
    ? 'Your partner or spouse birthdate'
    : 'Partner or spouse birthdate';
  document.getElementById('childrenQuestion').textContent = isSelf
    ? 'Do you have children?'
    : 'Does this person have children?';
  document.getElementById('childrenListLabel').textContent = isSelf
    ? 'Add children'
    : 'Add children';
  document.getElementById('grandchildrenQuestion').textContent = isSelf
    ? 'Do you have grandchildren?'
    : 'Does this person have grandchildren?';
  document.getElementById('grandchildrenListLabel').textContent = isSelf
    ? 'Add grandchildren'
    : 'Add grandchildren';

  const relationshipGroup = document.getElementById('relationshipGroup');
  if (relationshipGroup) {
    window.AncestrioDomDisplay.setDisplay(relationshipGroup, isSelf ? 'none' : 'block');
  }
  if (isSelf) {
    document.getElementById('creatorRelationship').value = '';
    document.getElementById('creatorRelationshipOther').value = '';
  }
  updateRelationshipOtherVisibility();
}

function updateRelationshipOtherVisibility() {
  const relationship = document.getElementById('creatorRelationship').value;
  const shouldShow = getWizardCenterMode() === 'other' && relationship === 'other';
  const otherGroup = document.getElementById('relationshipOtherGroup');
  if (!otherGroup) return;
  window.AncestrioDomDisplay.setDisplay(otherGroup, shouldShow ? 'block' : 'none');
}

function updateSiblingsBlock() {
  const hasSiblings = document.querySelector('input[name="hasSiblings"]:checked')?.value === 'yes';
  const block = document.getElementById('siblingsBlock');
  if (!block) return;
  window.AncestrioDomDisplay.setDisplay(block, hasSiblings ? 'block' : 'none');
  if (hasSiblings && !document.querySelector('#siblingsList .person-row')) {
    addSplitNameRow('siblingsList', 'Sibling');
  }
}

function updateChildrenBlock() {
  const hasChildren = document.querySelector('input[name="hasChildren"]:checked')?.value === 'yes';
  const block = document.getElementById('childrenBlock');
  const grandchildrenQuestionGroup = document.getElementById('grandchildrenQuestionGroup');
  if (block) {
    window.AncestrioDomDisplay.setDisplay(block, hasChildren ? 'block' : 'none');
  }
  if (grandchildrenQuestionGroup) {
    window.AncestrioDomDisplay.setDisplay(grandchildrenQuestionGroup, hasChildren ? 'block' : 'none');
  }
  if (hasChildren && !document.querySelector('#childrenList .person-row')) {
    addSplitNameRow('childrenList', 'Child');
  }
  if (!hasChildren) {
    const noGrandchildren = document.querySelector('input[name="hasGrandchildren"][value="no"]');
    if (noGrandchildren) noGrandchildren.checked = true;
  }
  updateGrandchildrenBlock();
}

function updateGrandchildrenBlock() {
  const hasChildren = document.querySelector('input[name="hasChildren"]:checked')?.value === 'yes';
  const hasGrandchildren = hasChildren && (document.querySelector('input[name="hasGrandchildren"]:checked')?.value === 'yes');
  const block = document.getElementById('grandchildrenBlock');
  if (!block) return;
  window.AncestrioDomDisplay.setDisplay(block, hasGrandchildren ? 'block' : 'none');
  if (hasGrandchildren && !document.querySelector('#grandchildrenList .person-row')) {
    addSplitNameRow('grandchildrenList', 'Grandchild');
  }
}

function addPersonRow(listId, placeholder, value = '', options = {}) {
  const list = document.getElementById(listId);
  if (!list) return;
  const includeInlineAdd = Boolean(options.includeInlineAdd);
  const normalizedLabel = sanitizeText(placeholder).toLowerCase() || 'person';

  const row = document.createElement('div');
  row.className = includeInlineAdd ? 'person-row sibling-row' : 'person-row';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'form-input person-row-input';
  input.placeholder = placeholder;
  input.value = value;

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'btn-secondary btn-inline btn-person-control btn-remove-person';
  removeBtn.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">remove</span>';
  removeBtn.setAttribute('aria-label', `Remove ${normalizedLabel}`);
  removeBtn.setAttribute('title', `Remove ${normalizedLabel}`);
  removeBtn.addEventListener('click', () => {
    row.remove();
    if (includeInlineAdd && !list.querySelector('.person-row')) {
      addPersonRow(listId, placeholder, '', options);
    }
  });

  row.appendChild(input);
  row.appendChild(removeBtn);
  if (includeInlineAdd) {
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn-secondary btn-inline btn-person-control btn-add-person';
    addBtn.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">add</span>';
    addBtn.setAttribute('aria-label', `Add ${normalizedLabel}`);
    addBtn.setAttribute('title', `Add ${normalizedLabel}`);
    addBtn.addEventListener('click', () => {
      addPersonRow(listId, placeholder, '', options);
    });
    row.appendChild(addBtn);
  }
  list.appendChild(row);
}

function addSplitNameRow(listId, personLabel, values = {}, options = {}) {
  const list = document.getElementById(listId);
  if (!list) return;
  const controls = list.querySelector('.person-list-controls');

  const row = document.createElement('div');
  row.className = 'person-row';

  const nameFields = document.createElement('div');
  nameFields.className = 'person-row-name-fields';

  const firstNameGroup = document.createElement('div');
  firstNameGroup.className = 'name-input-group';
  const firstNameLabel = document.createElement('label');
  firstNameLabel.className = 'form-label name-sub-label';
  firstNameLabel.textContent = 'First Name';
  const firstNameInput = document.createElement('input');
  firstNameInput.type = 'text';
  firstNameInput.className = 'form-input';
  firstNameInput.placeholder = 'First name';
  firstNameInput.dataset.namePart = 'first';
  firstNameInput.setAttribute('aria-label', `${personLabel} first name`);
  firstNameInput.value = sanitizeText(values.firstName);
  firstNameGroup.appendChild(firstNameLabel);
  firstNameGroup.appendChild(firstNameInput);

  const lastNameGroup = document.createElement('div');
  lastNameGroup.className = 'name-input-group';
  const lastNameLabel = document.createElement('label');
  lastNameLabel.className = 'form-label name-sub-label';
  lastNameLabel.textContent = 'Last Name';
  const lastNameInput = document.createElement('input');
  lastNameInput.type = 'text';
  lastNameInput.className = 'form-input';
  lastNameInput.placeholder = 'Last name';
  lastNameInput.dataset.namePart = 'last';
  lastNameInput.setAttribute('aria-label', `${personLabel} last name`);
  lastNameInput.value = sanitizeText(values.lastName);
  lastNameGroup.appendChild(lastNameLabel);
  lastNameGroup.appendChild(lastNameInput);

  const birthdateGroup = document.createElement('div');
  birthdateGroup.className = 'name-input-group person-birthdate-group';
  const birthdateLabel = document.createElement('label');
  birthdateLabel.className = 'form-label name-sub-label';
  birthdateLabel.textContent = 'Birthdate';
  const birthdateInput = document.createElement('input');
  birthdateInput.type = 'text';
  birthdateInput.className = 'form-input';
  birthdateInput.placeholder = '06/01/1950';
  birthdateInput.maxLength = 10;
  birthdateInput.inputMode = 'numeric';
  birthdateInput.dataset.namePart = 'birthdate';
  birthdateInput.setAttribute('aria-label', `${personLabel} birthdate`);
  birthdateInput.value = sanitizeText(values.birthdate);
  const birthdaysEnabled = areWizardBirthdaysEnabled();
  window.AncestrioDomDisplay.setDisplay(birthdateGroup, birthdaysEnabled ? '' : 'none');
  birthdateInput.disabled = !birthdaysEnabled;
  if (!birthdaysEnabled) birthdateInput.value = '';
  attachBirthdateMask(birthdateInput);
  birthdateGroup.appendChild(birthdateLabel);
  birthdateGroup.appendChild(birthdateInput);

  nameFields.appendChild(firstNameGroup);
  nameFields.appendChild(lastNameGroup);
  nameFields.appendChild(birthdateGroup);

  row.appendChild(nameFields);
  if (controls) {
    list.insertBefore(row, controls);
  } else {
    list.appendChild(row);
  }
  ensureSplitNameListControls(list, listId, personLabel, options);
  updateSplitNameListState(list);
}

function ensureSplitNameListControls(list, listId, personLabel, options = {}) {
  if (!list || list.querySelector('.person-list-controls')) return;
  const normalizedLabel = sanitizeText(personLabel).toLowerCase() || 'person';

  const controls = document.createElement('div');
  controls.className = 'person-list-controls';

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'btn-secondary btn-inline btn-person-control btn-remove-person';
  removeBtn.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">remove</span><span class="btn-person-control-text">Remove</span>';
  removeBtn.setAttribute('aria-label', `Remove ${normalizedLabel}`);
  removeBtn.setAttribute('title', `Remove ${normalizedLabel}`);
  removeBtn.addEventListener('click', () => {
    const rows = list.querySelectorAll('.person-row');
    if (!rows.length) {
      addSplitNameRow(listId, personLabel, {}, options);
      return;
    }
    if (rows.length === 1) {
      rows[0].querySelectorAll('input').forEach((input) => {
        input.value = '';
      });
      updateSplitNameListState(list);
      return;
    }
    rows[rows.length - 1].remove();
    updateSplitNameListState(list);
  });

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn-secondary btn-inline btn-person-control btn-add-person';
  addBtn.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">add</span><span class="btn-person-control-text">Add</span>';
  addBtn.setAttribute('aria-label', `Add ${normalizedLabel}`);
  addBtn.setAttribute('title', `Add ${normalizedLabel}`);
  addBtn.addEventListener('click', () => {
    addSplitNameRow(listId, personLabel, {}, options);
  });

  controls.appendChild(removeBtn);
  controls.appendChild(addBtn);
  list.appendChild(controls);
  updateSplitNameListState(list);
}

function updateSplitNameListState(list) {
  if (!list) return;
  const rowCount = list.querySelectorAll('.person-row').length;
  list.classList.toggle('has-multiple-rows', rowCount > 1);
}

function collectSplitPeople(listId) {
  const list = document.getElementById(listId);
  if (!list) return [];
  const people = [];
  list.querySelectorAll('.person-row').forEach((row) => {
    const firstName = row.querySelector('input[data-name-part="first"]')?.value || '';
    const lastName = row.querySelector('input[data-name-part="last"]')?.value || '';
    const birthdate = row.querySelector('input[data-name-part="birthdate"]')?.value || '';
    const fullName = combineNames(firstName, lastName);
    if (fullName) {
      people.push({
        name: fullName,
        birthdate: sanitizeText(birthdate)
      });
    }
  });
  return people;
}

function clearList(listId) {
  const list = document.getElementById(listId);
  if (list) list.innerHTML = '';
}

function clearWizardBirthdateValues() {
  ['centralBirthdate', 'fatherBirthdate', 'motherBirthdate', 'partnerBirthdate'].forEach((inputId) => {
    const input = document.getElementById(inputId);
    if (input) input.value = '';
  });
  document.querySelectorAll('input[data-name-part="birthdate"]').forEach((input) => {
    input.value = '';
  });
  const birthdateInfo = document.getElementById('birthdateInfo');
  const birthdateInfoBtn = document.getElementById('birthdateInfoBtn');
  window.AncestrioDomDisplay.hide(birthdateInfo);
  if (birthdateInfoBtn) birthdateInfoBtn.setAttribute('aria-expanded', 'false');
}

function updateBirthdaysPreferenceForWizard() {
  const birthdaysEnabled = areWizardBirthdaysEnabled();
  ['centralBirthdateGroup', 'fatherBirthdateGroup', 'motherBirthdateGroup', 'partnerBirthdateGroup'].forEach((groupId) => {
    const group = document.getElementById(groupId);
    if (!group) return;
    window.AncestrioDomDisplay.setDisplay(group, birthdaysEnabled ? 'block' : 'none');
  });
  document.querySelectorAll('.person-birthdate-group').forEach((group) => {
    window.AncestrioDomDisplay.setDisplay(group, birthdaysEnabled ? '' : 'none');
  });
  document.querySelectorAll('input[data-name-part="birthdate"]').forEach((input) => {
    input.disabled = !birthdaysEnabled;
  });
  if (!birthdaysEnabled) {
    clearWizardBirthdateValues();
  }
}

function toggleBirthdateInfo() {
  if (!areWizardBirthdaysEnabled()) return;
  const info = document.getElementById('birthdateInfo');
  const button = document.getElementById('birthdateInfoBtn');
  if (!info || !button) return;
  const isOpen = window.AncestrioDomDisplay.isInlineVisible(info);
  window.AncestrioDomDisplay.setDisplay(info, isOpen ? 'none' : 'block');
  button.setAttribute('aria-expanded', String(!isOpen));
}

function setupBirthdateInputMasks() {
  ['centralBirthdate', 'fatherBirthdate', 'motherBirthdate', 'partnerBirthdate'].forEach((inputId) => {
    const input = document.getElementById(inputId);
    if (!input) return;
    attachBirthdateMask(input);
  });
}

function attachBirthdateMask(input) {
  if (!input || input.dataset.birthdateMaskApplied === 'true') return;

  input.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const allowedKeys = ['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Tab'];
    if (allowedKeys.includes(event.key)) return;
    if (!/^\d$/.test(event.key)) {
      event.preventDefault();
    }
  });

  input.addEventListener('input', () => {
    input.value = formatBirthdateInputValue(input.value);
  });

  input.dataset.birthdateMaskApplied = 'true';
}

function formatBirthdateInputValue(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function clearFieldError(inputId, errorId) {
  const input = document.getElementById(inputId);
  const error = document.getElementById(errorId);
  if (input) input.classList.remove('error');
  window.AncestrioDomDisplay.hide(error);
}

function clearCentralNameError() {
  const error = document.getElementById('centralPersonNameError');
  const firstName = document.getElementById('centralPersonFirstName');
  const lastName = document.getElementById('centralPersonLastName');
  window.AncestrioDomDisplay.hide(error);
  setCentralNameFieldError(firstName, false);
  setCentralNameFieldError(lastName, false);
}

function setCentralNameFieldError(input, hasError) {
  if (!input) return;
  input.classList.toggle('error', hasError);
  const inputGroup = input.closest('.name-input-group');
  if (inputGroup) {
    inputGroup.classList.toggle('has-error', hasError);
  }
}

function syncCentralNameValidationState() {
  const error = document.getElementById('centralPersonNameError');
  const firstName = document.getElementById('centralPersonFirstName');
  const lastName = document.getElementById('centralPersonLastName');
  if (!firstName || !lastName) return;

  const firstMissing = !firstName.value.trim();
  const lastMissing = !lastName.value.trim();

  if (!window.AncestrioDomDisplay.isInlineVisible(error)) {
    if (!firstMissing && !lastMissing) {
      setCentralNameFieldError(firstName, false);
      setCentralNameFieldError(lastName, false);
    }
    return;
  }

  error.textContent = 'First name and last name are required';
  if (!firstMissing && !lastMissing) {
    clearCentralNameError();
    return;
  }

  setCentralNameFieldError(firstName, firstMissing);
  setCentralNameFieldError(lastName, lastMissing);
}

function setFieldError(inputId, errorId, message) {
  const input = document.getElementById(inputId);
  const error = document.getElementById(errorId);
  if (input) input.classList.add('error');
  showErrorText(error, message);
}

function validateStep2() {
  const treeName = document.getElementById('treeName').value.trim();
  const centralFirstName = document.getElementById('centralPersonFirstName').value.trim();
  const centralLastName = document.getElementById('centralPersonLastName').value.trim();
  let valid = true;

  clearFieldError('treeName', 'treeNameError');
  clearCentralNameError();

  if (!treeName) {
    setFieldError('treeName', 'treeNameError', 'Family tree name is required');
    valid = false;
  }
  if (!centralFirstName || !centralLastName) {
    const error = document.getElementById('centralPersonNameError');
    showErrorText(error, 'First name and last name are required');
    setCentralNameFieldError(document.getElementById('centralPersonFirstName'), !centralFirstName);
    setCentralNameFieldError(document.getElementById('centralPersonLastName'), !centralLastName);
    valid = false;
  }
  if (!valid) {
    if (!treeName) {
      document.getElementById('treeName').focus();
    } else if (!centralFirstName) {
      document.getElementById('centralPersonFirstName').focus();
    } else {
      document.getElementById('centralPersonLastName').focus();
    }
  }
  return valid;
}

function getCurrentUserName(user) {
  if (!user) return '';
  if (user.isAnonymous) return 'Guest';
  const displayName = user.displayName ? user.displayName.trim() : '';
  if (displayName) return displayName;
  const email = user.email ? user.email.trim() : '';
  if (!email) return '';
  return email.includes('@') ? email.split('@')[0] : email;
}

function updateDashboardTitle(user) {
  const titleEl = document.getElementById('dashboardTitle');
  if (!titleEl) return;
  if (user && user.isAnonymous) {
    titleEl.textContent = 'Your Family Trees';
    return;
  }

  const username = getCurrentUserName(user);
  titleEl.textContent = username ? `${username}'s Family Trees` : 'Your Family Trees';
}

function withTimeout(promise, timeoutMs, timeoutCode) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      const timeoutError = new Error('Operation timed out');
      timeoutError.code = timeoutCode || 'timeout';
      reject(timeoutError);
    }, timeoutMs);

    promise
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timer);
        reject(error);
      });
  });
}

function showDashboardStatus(message) {
  const hero = document.querySelector('.dashboard-hero');
  if (!hero) return;
  let status = document.getElementById('dashboardStatus');
  if (!status) {
    status = document.createElement('p');
    status.id = 'dashboardStatus';
    status.className = 'dashboard-status';
    hero.appendChild(status);
  }
  status.textContent = message;
  window.AncestrioDomDisplay.show(status);
}

function clearDashboardStatus() {
  const status = document.getElementById('dashboardStatus');
  if (!status) return;
  status.textContent = '';
  window.AncestrioDomDisplay.hide(status);
}

function mapTreesFromSnapshot(snapshot) {
  const mappedTrees = snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data()
  }));

  mappedTrees.sort((a, b) => {
    const dateA = a.createdAt ? a.createdAt.toMillis() : 0;
    const dateB = b.createdAt ? b.createdAt.toMillis() : 0;
    return dateB - dateA;
  });

  return mappedTrees;
}

function setCreateTreeButtonVisibility(visible) {
  const createTreeActions = document.querySelector('.dashboard-hero-actions');
  window.AncestrioDomDisplay.setDisplay(createTreeActions, visible ? 'block' : 'none');
}

function configureGuestDashboardUI() {
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.setAttribute('title', 'Exit guest mode');
    logoutBtn.setAttribute('aria-label', 'Exit guest mode');
  }
  const logoutText = document.querySelector('#logoutBtn .logout-text');
  if (logoutText) {
    logoutText.textContent = 'Exit Guest';
  }
}

function getStoredGuestTree() {
  try {
    const raw = localStorage.getItem(LOCAL_GUEST_TREE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch (error) {
    console.warn('Failed to read local guest tree:', error);
    return null;
  }
}

function hasStoredGuestTree() {
  const stored = getStoredGuestTree();
  return !!(stored && stored.data && typeof stored.data === 'object' && Object.keys(stored.data).length > 0);
}

function updateGuestEmptyState(hasTree) {
  const emptyState = document.getElementById('emptyState');
  if (!emptyState) return;

  const heading = emptyState.querySelector('h3');
  if (heading) {
    heading.textContent = hasTree ? 'Continue your local family tree' : 'No local family tree yet';
  }

  const description = emptyState.querySelector('p');
  if (description) {
    description.textContent = hasTree
      ? 'Your guest data is stored only in this browser.'
      : 'Use the setup wizard to create your first local family tree.';
  }

  const createButton = document.getElementById('createTreeBtnEmpty');
  if (createButton) {
    createButton.innerHTML = hasTree
      ? '<span class="material-symbols-outlined">add</span>Start a New Local Tree'
      : '<span class="material-symbols-outlined">add</span>Create Your First Tree';
  }

  let continueButton = document.getElementById('continueGuestTreeBtn');
  if (hasTree) {
    if (!continueButton) {
      continueButton = document.createElement('button');
      continueButton.id = 'continueGuestTreeBtn';
      continueButton.className = 'create-tree-btn-secondary continue-guest-tree-btn';
      continueButton.innerHTML = '<span class="material-symbols-outlined">edit</span>Continue Local Tree';
      continueButton.addEventListener('click', () => {
        window.location.href = 'editor.html?guest=1';
      });
      if (createButton) {
        createButton.insertAdjacentElement('beforebegin', continueButton);
      } else {
        emptyState.appendChild(continueButton);
      }
    }
    return;
  }

  if (continueButton) {
    continueButton.remove();
  }
}

function renderTreesState(treesGrid, emptyState) {
  if (treesGrid) treesGrid.innerHTML = '';
  const hasTrees = trees.length > 0;
  setCreateTreeButtonVisibility(hasTrees);
  if (!hasTrees) {
    window.AncestrioDomDisplay.show(emptyState);
    return;
  }
  window.AncestrioDomDisplay.hide(emptyState);
  trees.forEach((tree) => renderTreeCard(tree));
}

async function loadTrees() {
  const treesGrid = document.getElementById('treesGrid');
  const emptyState = document.getElementById('emptyState');
  const loadingState = document.getElementById('loadingState');

  if (isLocalGuestMode) {
    trees = [];
    clearDashboardStatus();
    if (treesGrid) treesGrid.innerHTML = '';
    window.AncestrioDomDisplay.hide(loadingState);
    setCreateTreeButtonVisibility(false);
    updateGuestEmptyState(hasStoredGuestTree());
    window.AncestrioDomDisplay.show(emptyState);
    return;
  }

  setCreateTreeButtonVisibility(false);
  window.AncestrioDomDisplay.show(loadingState);
  window.AncestrioDomDisplay.hide(emptyState);
  if (treesGrid) treesGrid.innerHTML = '';
  let renderedCachedTrees = false;

  try {
    // Show cached trees immediately if available, then refresh from network.
    try {
      const cachedSnapshot = await db.collection('trees')
        .where('userId', '==', currentUser.uid)
        .get({ source: 'cache' });
      const cachedTrees = mapTreesFromSnapshot(cachedSnapshot);
      if (cachedTrees.length) {
        trees = cachedTrees;
        renderTreesState(treesGrid, emptyState);
        renderedCachedTrees = true;
      }
    } catch (cacheError) {
      console.debug('No cached trees available:', cacheError?.message || cacheError);
    }

    // Simple query without orderBy - no index needed
    const snapshot = await withTimeout(
      db.collection('trees')
        .where('userId', '==', currentUser.uid)
        .get(),
      TREE_LOAD_TIMEOUT_MS,
      'firestore/timeout'
    );

    trees = mapTreesFromSnapshot(snapshot);
    clearDashboardStatus();
    renderTreesState(treesGrid, emptyState);
  } catch (error) {
    console.error('Error loading trees:', error);
    console.error('Error code:', error.code);
    console.error('Error message:', error.message);
    
    // Show specific error message
    let errorMsg = 'Failed to load trees. ';
    if (error.code === 'permission-denied') {
      errorMsg += 'Firestore is not enabled or security rules are blocking access. Please enable Firestore in Firebase Console.';
    } else if (error.code === 'unavailable') {
      errorMsg += 'Firestore service is unavailable. It may not be enabled yet.';
    } else if (error.code === 'firestore/timeout') {
      errorMsg += 'Loading timed out. Check your connection and try again.';
    } else {
      errorMsg += error.message;
    }
    if (renderedCachedTrees) {
      errorMsg += ' Showing cached trees.';
    }
    showDashboardStatus(errorMsg);
    
    // Show empty state so user can still create trees
    if (!renderedCachedTrees) window.AncestrioDomDisplay.show(emptyState);
  } finally {
    window.AncestrioDomDisplay.hide(loadingState);
  }
}

function renderTreeCard(tree) {
  const treesGrid = document.getElementById('treesGrid');
  const memberCount = countMembers(tree.data || {});
  const createdDate = tree.createdAt ? new Date(tree.createdAt.toDate()).toLocaleDateString() : 'Unknown';
  const descriptionText = typeof tree.description === 'string' ? tree.description.trim() : '';
  const hasDescription = descriptionText.length > 0;

  const card = document.createElement('div');
  card.className = 'tree-card';
  
  // Generate preview HTML
  const previewHtml = tree.thumbnailData 
    ? `<div class="tree-card-preview"><img src="${tree.thumbnailData}" alt="Tree preview" /></div>`
    : `<div class="tree-card-preview">
         <div class="tree-card-preview-placeholder">
           <span class="material-symbols-outlined">account_tree</span>
           <span>No preview available</span>
         </div>
       </div>`;
  
  card.innerHTML = `
    <div class="tree-card-header">
      <div>
        <h3 class="tree-card-title">${escapeHtml(tree.name)}</h3>
        <span class="privacy-badge ${tree.privacy}">${tree.privacy === 'public' ? 'Public' : 'Private'}</span>
      </div>
      <div class="tree-card-actions">
        <button class="icon-btn delete" data-id="${tree.id}" data-name="${escapeHtml(tree.name)}" title="Delete">
          <span class="material-symbols-outlined">delete</span>
        </button>
      </div>
    </div>
    ${previewHtml}
    <p class="tree-card-description${hasDescription ? '' : ' is-empty'}"${hasDescription ? ` title="${escapeHtml(descriptionText)}"` : ''}>${hasDescription ? escapeHtml(descriptionText) : '&nbsp;'}</p>
    <div class="tree-card-meta">
      <span class="meta-item">
        <span class="material-symbols-outlined">group</span>
        ${memberCount} ${memberCount === 1 ? 'member' : 'members'}
      </span>
      <span class="meta-item">
        <span class="material-symbols-outlined">calendar_today</span>
        ${createdDate}
      </span>
    </div>
    <div class="tree-card-actions-bottom">
      <button class="btn-view" data-action="view-tree" data-tree-id="${tree.id}">
        <span class="material-symbols-outlined">visibility</span>
        View
      </button>
      <button class="btn-edit" data-action="edit-tree" data-tree-id="${tree.id}">
        <span class="material-symbols-outlined">edit</span>
        Edit
      </button>
    </div>
  `;

  // Attach delete handler
  card.querySelector('.icon-btn.delete').addEventListener('click', (e) => {
    showDeleteModal(e.currentTarget.dataset.id, e.currentTarget.dataset.name);
  });
  card.querySelector('[data-action="view-tree"]')?.addEventListener('click', (e) => {
    const targetTreeId = e.currentTarget.dataset.treeId;
    if (targetTreeId) {
      viewTree(targetTreeId);
    }
  });
  card.querySelector('[data-action="edit-tree"]')?.addEventListener('click', (e) => {
    const targetTreeId = e.currentTarget.dataset.treeId;
    if (targetTreeId) {
      editTree(targetTreeId);
    }
  });

  treesGrid.appendChild(card);
}

function countMembers(data) {
  if (!data || typeof data !== 'object') return 0;
  let count = 0;
  const visited = new WeakSet();

  function hasTextValue(value) {
    return typeof value === 'string' && value.trim().length > 0;
  }

  function isPersonLike(node) {
    if (!node || typeof node !== 'object') return false;
    return (
      hasTextValue(node.name) ||
      hasTextValue(node.Grandparent) ||
      hasTextValue(node.image) ||
      hasTextValue(node.birthday) ||
      hasTextValue(node.dob) ||
      (Array.isArray(node.tags) && node.tags.length > 0) ||
      node.isOrigin === true ||
      !!node.parents ||
      !!node.spouseParents ||
      !!node.spouse ||
      !!node.prevSpouse ||
      (Array.isArray(node.children) && node.children.length > 0) ||
      (Array.isArray(node.Parent) && node.Parent.length > 0) ||
      (Array.isArray(node.grandchildren) && node.grandchildren.length > 0)
    );
  }

  function traverseSpouse(rawSpouse) {
    if (!rawSpouse) return;
    if (Array.isArray(rawSpouse)) {
      rawSpouse.forEach((entry) => traverseSpouse(entry));
      return;
    }

    if (typeof rawSpouse === 'string') {
      if (rawSpouse.trim()) count++;
      return;
    }

    if (typeof rawSpouse === 'object') {
      traverse(rawSpouse);
    }
  }

  function traverse(node) {
    if (!node || typeof node !== 'object') return;
    if (visited.has(node)) return;
    visited.add(node);

    if (isPersonLike(node)) {
      count++;
    }

    traverseSpouse(node.spouse);
    traverseSpouse(node.prevSpouse);

    if (node.parents && typeof node.parents === 'object') {
      traverse(node.parents);
    }
    if (node.spouseParents && typeof node.spouseParents === 'object') {
      traverse(node.spouseParents);
    }

    if (Array.isArray(node.children)) {
      node.children.forEach((child) => traverse(child));
    }
    if (Array.isArray(node.Parent)) {
      node.Parent.forEach((child) => traverse(child));
    }
    if (Array.isArray(node.grandchildren)) {
      node.grandchildren.forEach((child) => traverse(child));
    }
    if (Array.isArray(node.childrenStrings)) {
      node.childrenStrings.forEach((name) => {
        if (typeof name === 'string' && name.trim()) count++;
      });
    }
  }

  traverse(data);
  return count;
}
function showCreateModal() {
  window.AncestrioDomDisplay.show('createTreeModal', 'flex');
  resetWizard();
  goToStep(1);
  const modeInput = document.querySelector('input[name="centerMode"][value="me"]');
  if (modeInput) modeInput.focus();
}

function hideCreateModal() {
  window.AncestrioDomDisplay.hide('createTreeModal');
  resetWizard();
}

function goToStep(step) {
  const totalSteps = 5;
  const nextStep = Math.max(1, Math.min(totalSteps, Number(step) || 1));

  // Hide all steps
  document.querySelectorAll('.wizard-step').forEach(s => s.classList.remove('active'));
  
  // Show selected step
  const stepEl = document.getElementById(`step${nextStep}`);
  if (stepEl) {
    stepEl.classList.add('active');
  }
  
  // Update progress indicator
  document.querySelectorAll('.progress-step').forEach(p => {
    p.classList.remove('active');
  });
  const progressStep = document.querySelector(`.progress-step[data-step="${nextStep}"]`);
  if (progressStep) {
    progressStep.classList.add('active');
  }

  currentWizardStep = nextStep;
  updateWizardNavigation();
}

function updateWizardNavigation() {
  const backBtn = document.getElementById('wizardBackBtn');
  const nextBtn = document.getElementById('wizardNextBtn');
  if (!backBtn || !nextBtn) return;

  backBtn.textContent = currentWizardStep === 1 ? 'Cancel' : 'Back';
  nextBtn.textContent = currentWizardStep === 5 ? 'Create Tree' : 'Next';
}

function resetWizard() {
  wizardCenterNameTouched = false;
  const defaultName = getCurrentUserName(currentUser) || 'Family Member';
  const defaultNameParts = splitFullName(defaultName);

  document.querySelector('input[name="centerMode"][value="me"]').checked = true;
  const birthdaysYes = document.querySelector('input[name="enableBirthdays"][value="yes"]');
  if (birthdaysYes) birthdaysYes.checked = true;
  const globeCountriesYes = document.querySelector('input[name="enableGlobeCountries"][value="yes"]');
  if (globeCountriesYes) globeCountriesYes.checked = true;
  document.getElementById('treeName').value = '';
  document.getElementById('treeDescription').value = '';
  document.querySelector('input[name="privacy"][value="private"]').checked = true;
  document.getElementById('centralPersonFirstName').value = defaultNameParts.firstName;
  document.getElementById('centralPersonLastName').value = defaultNameParts.lastName;
  document.getElementById('centralBirthdate').value = '';
  document.getElementById('centralPhotoUrl').value = '';
  document.getElementById('creatorRelationship').value = '';
  document.getElementById('creatorRelationshipOther').value = '';
  document.getElementById('fatherFirstName').value = '';
  document.getElementById('fatherLastName').value = '';
  document.getElementById('fatherBirthdate').value = '';
  document.getElementById('motherFirstName').value = '';
  document.getElementById('motherLastName').value = '';
  document.getElementById('motherBirthdate').value = '';
  document.getElementById('partnerFirstName').value = '';
  document.getElementById('partnerLastName').value = '';
  document.getElementById('partnerBirthdate').value = '';
  document.querySelector('input[name="hasSiblings"][value="no"]').checked = true;
  document.querySelector('input[name="hasChildren"][value="no"]').checked = true;
  document.querySelector('input[name="hasGrandchildren"][value="no"]').checked = true;
  clearList('siblingsList');
  clearList('childrenList');
  clearList('grandchildrenList');
  
  // Clear error state
  clearFieldError('treeName', 'treeNameError');
  clearCentralNameError();
  const birthdateInfo = document.getElementById('birthdateInfo');
  const birthdateInfoBtn = document.getElementById('birthdateInfoBtn');
  window.AncestrioDomDisplay.hide(birthdateInfo);
  if (birthdateInfoBtn) birthdateInfoBtn.setAttribute('aria-expanded', 'false');
  
  updateBirthdaysPreferenceForWizard();
  updateWizardPerspective();
  updateRelationshipOtherVisibility();
  updateSiblingsBlock();
  updateChildrenBlock();
  updateGrandchildrenBlock();
  goToStep(1);
}

async function createTreeFromWizard(e) {
  if (e && typeof e.preventDefault === 'function') {
    e.preventDefault();
  }
  if (!validateStep2()) {
    goToStep(2);
    return;
  }
  
  // Step 2: basic info
  const name = document.getElementById('treeName').value.trim();
  const description = document.getElementById('treeDescription').value.trim();
  const privacy = document.querySelector('input[name="privacy"]:checked').value;

  // Step 2: central person
  const centerMode = getWizardCenterMode();
  const birthdaysEnabled = areWizardBirthdaysEnabled();
  const globeCountriesEnabled = areWizardGlobeCountriesEnabled();
  const centerName = combineNames(
    document.getElementById('centralPersonFirstName').value,
    document.getElementById('centralPersonLastName').value
  );
  const centerBirthdate = birthdaysEnabled ? document.getElementById('centralBirthdate').value.trim() : '';
  const centerPhotoUrl = document.getElementById('centralPhotoUrl').value.trim();
  const relationshipSelect = document.getElementById('creatorRelationship').value;
  const relationshipOther = document.getElementById('creatorRelationshipOther').value.trim();
  const relationshipToCenter = relationshipSelect === 'other' ? relationshipOther : relationshipSelect;

  // Step 3-5: family structure
  const fatherName = combineNames(
    document.getElementById('fatherFirstName').value,
    document.getElementById('fatherLastName').value
  );
  const fatherBirthdate = birthdaysEnabled ? document.getElementById('fatherBirthdate').value.trim() : '';
  const motherName = combineNames(
    document.getElementById('motherFirstName').value,
    document.getElementById('motherLastName').value
  );
  const motherBirthdate = birthdaysEnabled ? document.getElementById('motherBirthdate').value.trim() : '';
  const normalizePeopleBirthdates = (people) => {
    if (birthdaysEnabled) return people;
    return people.map((person) => ({
      ...person,
      birthdate: ''
    }));
  };
  const hasSiblings = document.querySelector('input[name="hasSiblings"]:checked')?.value === 'yes';
  const siblings = hasSiblings ? normalizePeopleBirthdates(collectSplitPeople('siblingsList')) : [];
  const partnerName = combineNames(
    document.getElementById('partnerFirstName').value,
    document.getElementById('partnerLastName').value
  );
  const partnerBirthdate = birthdaysEnabled ? document.getElementById('partnerBirthdate').value.trim() : '';
  const hasChildren = document.querySelector('input[name="hasChildren"]:checked')?.value === 'yes';
  const children = hasChildren ? normalizePeopleBirthdates(collectSplitPeople('childrenList')) : [];
  const hasGrandchildren = hasChildren && (document.querySelector('input[name="hasGrandchildren"]:checked')?.value === 'yes');
  const grandchildren = hasGrandchildren ? normalizePeopleBirthdates(collectSplitPeople('grandchildrenList')) : [];
  
  const createBtn = document.getElementById('wizardNextBtn');
  if (createBtn) {
    createBtn.disabled = true;
    createBtn.textContent = 'Creating...';
  }

  try {
    // Generate template based on explicit names and relationships
    const initialData = generateFamilyTemplate({
      centerMode,
      centerName,
      centerBirthdate,
      centerPhotoUrl,
      relationshipToCenter,
      enableBirthdays: birthdaysEnabled,
      enableGlobeCountries: globeCountriesEnabled,
      fatherName,
      fatherBirthdate,
      motherName,
      motherBirthdate,
      siblings,
      partnerName,
      partnerBirthdate,
      children,
      grandchildren
    });

    const wizardContext = {
      centerMode,
      centerName,
      relationshipToCenter: relationshipToCenter || null,
      enableBirthdays: birthdaysEnabled,
      enableGlobeCountries: globeCountriesEnabled
    };

    if (isLocalGuestMode) {
      localStorage.setItem(LOCAL_GUEST_TREE_KEY, JSON.stringify({
        name,
        description,
        privacy,
        enableCalendarDates: birthdaysEnabled,
        enableBirthdays: birthdaysEnabled,
        enableGlobeCountries: globeCountriesEnabled,
        data: initialData,
        wizardContext,
        updatedAt: Date.now()
      }));

      hideCreateModal();
      window.location.href = 'editor.html?guest=1';
      return;
    }

    const docRef = await db.collection('trees').add({
      userId: currentUser.uid,
      name: name,
      description: description,
      privacy: privacy,
      enableCalendarDates: birthdaysEnabled,
      enableBirthdays: birthdaysEnabled,
      enableGlobeCountries: globeCountriesEnabled,
      data: initialData,
      wizardContext,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    hideCreateModal();
    await loadTrees();
    
    // Redirect to editor
    window.location.href = `editor.html?id=${docRef.id}`;
  } catch (error) {
    console.error('Error creating tree:', error);
    notifyUser('Failed to create tree. Please try again.', 'error');
  } finally {
    if (createBtn) createBtn.disabled = false;
    updateWizardNavigation();
  }
}

function sanitizeText(value) {
  return value == null ? '' : String(value).trim();
}

function buildPersonNode(name, extras = {}) {
  return {
    name: sanitizeText(name) || 'Family Member',
    image: sanitizeText(extras.image),
    birthday: sanitizeText(extras.birthdate)
  };
}

function generateFamilyTemplate(options) {
  const birthdaysEnabled = options.enableBirthdays !== false;
  const globeCountriesEnabled = options.enableGlobeCountries !== false;
  const center = buildPersonNode(options.centerName, {
    image: options.centerPhotoUrl,
    birthdate: birthdaysEnabled ? options.centerBirthdate : ''
  });

  const fatherName = sanitizeText(options.fatherName);
  const fatherBirthdate = birthdaysEnabled ? sanitizeText(options.fatherBirthdate) : '';
  const motherName = sanitizeText(options.motherName);
  const motherBirthdate = birthdaysEnabled ? sanitizeText(options.motherBirthdate) : '';
  const partnerName = sanitizeText(options.partnerName);
  const partnerBirthdate = birthdaysEnabled ? sanitizeText(options.partnerBirthdate) : '';
  const normalizePeople = (entries) => {
    if (!Array.isArray(entries)) return [];
    return entries
      .map((entry) => {
        if (entry && typeof entry === 'object') {
          return {
            name: sanitizeText(entry.name),
            birthdate: birthdaysEnabled ? sanitizeText(entry.birthdate) : ''
          };
        }
        return {
          name: sanitizeText(entry),
          birthdate: ''
        };
      })
      .filter((person) => person.name);
  };

  const siblings = normalizePeople(options.siblings);
  const children = normalizePeople(options.children);
  const grandchildren = normalizePeople(options.grandchildren);

  const centerNode = buildPersonNode(center.name, {
    image: center.image,
    birthdate: center.birthday
  });
  centerNode.isOrigin = true;

  if (partnerName) {
    centerNode.spouse = buildPersonNode(partnerName, { birthdate: partnerBirthdate });
  }

  const childNodes = children
    .map((child) => buildPersonNode(child.name, { birthdate: child.birthdate }));

  const grandchildNodes = grandchildren
    .map((grandchild) => buildPersonNode(grandchild.name, { birthdate: grandchild.birthdate }));

  if (grandchildNodes.length) {
    if (!childNodes.length) {
      childNodes.push(buildPersonNode('Child'));
    }
    const primaryChild = childNodes[0];
    primaryChild.children = Array.isArray(primaryChild.children)
      ? primaryChild.children.concat(grandchildNodes)
      : grandchildNodes;
  }

  const siblingNodes = siblings
    .map((sibling) => buildPersonNode(sibling.name, { birthdate: sibling.birthdate }));

  // Children of the central person live under `children` when that person is inside Parent[].
  if (childNodes.length) {
    centerNode.children = childNodes;
  }

  const anchoredByParents = Boolean(fatherName || motherName || siblingNodes.length > 0);
  let data;

  if (anchoredByParents) {
    const primaryParent = fatherName || motherName || 'Parent';
    const primaryParentBirthdate = fatherName
      ? fatherBirthdate
      : (motherName ? motherBirthdate : (fatherBirthdate || motherBirthdate));
    data = {
      Grandparent: primaryParent,
      image: '',
      birthday: primaryParentBirthdate,
      Parent: [centerNode, ...siblingNodes]
    };
    if (fatherName && motherName) {
      data.spouse = buildPersonNode(motherName, { birthdate: motherBirthdate });
    } else {
      data.spouse = null;
    }
  } else {
    data = {
      Grandparent: center.name,
      image: center.image,
      birthday: center.birthday,
      isOrigin: true,
      Parent: childNodes
    };
    if (partnerName) {
      data.spouse = buildPersonNode(partnerName, { birthdate: partnerBirthdate });
    }
  }

  data.setupContext = {
    centerMode: sanitizeText(options.centerMode) || 'me',
    centerName: center.name,
    enableBirthdays: birthdaysEnabled,
    enableGlobeCountries: globeCountriesEnabled
  };

  const relationshipToCenter = sanitizeText(options.relationshipToCenter);
  if (relationshipToCenter) {
    data.setupContext.relationshipToCenter = relationshipToCenter;
  }

  return data;
}

function showDeleteModal(treeId, treeName) {
  treeToDelete = treeId;
  document.getElementById('deleteTreeName').textContent = treeName;
  window.AncestrioDomDisplay.show('deleteModal', 'flex');
}


function hideDeleteModal() {
  window.AncestrioDomDisplay.hide('deleteModal');
  treeToDelete = null;
}

async function confirmDelete() {
  if (!treeToDelete) return;

  const confirmBtn = document.getElementById('confirmDeleteBtn');
  confirmBtn.disabled = true;
  confirmBtn.textContent = 'Deleting...';

  try {
    await db.collection('trees').doc(treeToDelete).delete();
    hideDeleteModal();
    await loadTrees();
  } catch (error) {
    console.error('Error deleting tree:', error);
    notifyUser('Failed to delete tree. Please try again.', 'error');
  } finally {
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'Delete';
  }
}

async function logout() {
  if (isLocalGuestMode) {
    localStorage.removeItem('guestMode');
    window.location.href = 'auth.html';
    return;
  }

  try {
    await auth.signOut();
    window.location.href = 'auth.html';
  } catch (error) {
    console.error('Error signing out:', error);
    notifyUser('Failed to sign out. Please try again.', 'error');
  }
}

function viewTree(treeId) {
  window.location.href = `tree.html?id=${treeId}`;
}

function editTree(treeId) {
  window.location.href = `editor.html?id=${treeId}`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

