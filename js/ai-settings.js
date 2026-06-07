(function initializeAiSettings(global) {
    const DEFAULT_OPENAI_MODEL = 'gpt-5.2';
    const DEFAULT_GOOGLE_MODEL = 'gemini-3.5-flash';
    const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';
    const DEFAULT_OPENROUTER_MODEL = 'google/gemini-3.1-flash-lite';
    const AI_MODEL_CACHE_KEY = 'oriel.aiModelCache.v1';
    const AI_MODEL_REFRESH_SUCCESS_MS = 2600;
    const AI_PROVIDERS = [
        {
            id: 'openai',
            label: 'OpenAI',
            settingKey: 'aiOpenAIModel',
            screenshotSettingKey: 'aiScreenshotOpenAIModel',
            storageKey: 'aiOpenAIModel',
            defaultModel: DEFAULT_OPENAI_MODEL,
            curatedModels: ['gpt-5.2', 'gpt-5.2-mini', 'gpt-5.1', 'gpt-4.1']
        },
        {
            id: 'google',
            label: 'Gemini',
            settingKey: 'aiGoogleModel',
            screenshotSettingKey: 'aiScreenshotGoogleModel',
            storageKey: 'aiGoogleModel',
            defaultModel: DEFAULT_GOOGLE_MODEL,
            curatedModels: ['gemini-3.5-flash', 'gemini-3.5-pro', 'gemini-2.5-flash', 'gemini-2.5-pro']
        },
        {
            id: 'anthropic',
            label: 'Claude',
            settingKey: 'aiAnthropicModel',
            screenshotSettingKey: 'aiScreenshotAnthropicModel',
            storageKey: 'aiAnthropicModel',
            defaultModel: DEFAULT_ANTHROPIC_MODEL,
            curatedModels: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-haiku-4-20250514']
        },
        {
            id: 'openrouter',
            label: 'OpenRouter',
            settingKey: 'aiOpenRouterModel',
            screenshotSettingKey: 'aiScreenshotOpenRouterModel',
            storageKey: 'aiOpenRouterModel',
            defaultModel: DEFAULT_OPENROUTER_MODEL,
            curatedModels: [
                'google/gemini-3.1-flash-lite',
                'google/gemini-3.0-flash-lite-preview',
                'google/gemini-2.5-flash-lite',
                'openai/gpt-5.2-mini'
            ]
        }
    ];

    let aiKeyStatus = { openai: false, google: false, anthropic: false, openrouter: false };
    let aiModelCache = loadAiModelCache();
    let aiInitialized = false;
    let aiSettingsFeedbackTimer = null;
    let aiKeyProvider = '';
    let aiKeyEditProvider = null;
    let aiModelRefreshState = { provider: '', status: 'idle', message: '', count: 0, refreshedAt: '' };
    let aiModelRefreshConfirm = { picker: '', provider: '' };
    let aiModelRefreshSuccessTimer = null;
    const MODEL_PICKERS = {
        ask: {
            button: 'settings-ai-model-picker-button',
            label: 'settings-ai-model-picker-label',
            menu: 'settings-ai-model-picker-menu',
            search: 'settings-ai-model-search-input',
            list: 'settings-ai-model-option-list',
            refreshButton: 'settings-ai-model-refresh-button',
            refreshLabel: 'settings-ai-model-refresh-label',
            confirm: 'settings-ai-model-refresh-confirm',
            confirmText: 'settings-ai-model-refresh-confirm-text',
            confirmButton: 'settings-ai-model-refresh-confirm-button',
            cancelButton: 'settings-ai-model-refresh-cancel-button',
            meta: 'settings-ai-model-refresh-meta'
        },
        screenshot: {
            button: 'settings-ai-screenshot-model-picker-button',
            label: 'settings-ai-screenshot-model-picker-label',
            menu: 'settings-ai-screenshot-model-picker-menu',
            search: 'settings-ai-screenshot-model-search-input',
            list: 'settings-ai-screenshot-model-option-list',
            refreshButton: 'settings-ai-screenshot-model-refresh-button',
            refreshLabel: 'settings-ai-screenshot-model-refresh-label',
            confirm: 'settings-ai-screenshot-model-refresh-confirm',
            confirmText: 'settings-ai-screenshot-model-refresh-confirm-text',
            confirmButton: 'settings-ai-screenshot-model-refresh-confirm-button',
            cancelButton: 'settings-ai-screenshot-model-refresh-cancel-button',
            meta: 'settings-ai-screenshot-model-refresh-meta'
        }
    };

    function byId(id) {
        return global.document?.getElementById?.(id) || null;
    }

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function providerConfig(provider) {
        return AI_PROVIDERS.find(candidate => candidate.id === provider) || null;
    }

    function providerIds() {
        return AI_PROVIDERS.map(provider => provider.id);
    }

    function providerLabel(provider) {
        return providerConfig(provider)?.label || 'AI';
    }

    function selectedProvider() {
        const provider = global.state?.settings?.aiProvider || '';
        return providerConfig(provider) ? provider : '';
    }

    function selectedKeyProvider() {
        return providerConfig(aiKeyProvider) ? aiKeyProvider : (selectedProvider() || 'openai');
    }

    function modelForProvider(provider) {
        const config = providerConfig(provider) || AI_PROVIDERS[0];
        return global.state?.settings?.[config.settingKey] || config.defaultModel;
    }

    function screenshotModelForProvider(provider) {
        const config = providerConfig(provider) || AI_PROVIDERS[0];
        return global.state?.settings?.[config.screenshotSettingKey] || config.defaultModel;
    }

    function selectedScreenshotProvider() {
        const provider = global.state?.settings?.aiScreenshotProvider;
        return providerConfig(provider) ? provider : (selectedProvider() || 'openai');
    }

    function selectedModel() {
        return modelForProvider(selectedProvider() || 'openai');
    }

    function selectedScreenshotModel() {
        return screenshotModelForProvider(selectedScreenshotProvider());
    }

    function loadAiModelCache() {
        try {
            const parsed = JSON.parse(global.localStorage?.getItem?.(AI_MODEL_CACHE_KEY) || '{}');
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (_error) {
            return {};
        }
    }

    function saveAiModelCache() {
        try {
            global.localStorage?.setItem?.(AI_MODEL_CACHE_KEY, JSON.stringify(aiModelCache));
        } catch (_error) {
            // Model cache is a non-secret convenience; ignore storage failures.
        }
    }

    function cachedModelsForProvider(provider) {
        const cached = aiModelCache?.[provider]?.models;
        return Array.isArray(cached) ? cached.filter(Boolean) : [];
    }

    function isCuratedModel(provider, model) {
        const config = providerConfig(provider);
        return Boolean(config?.curatedModels?.includes(model));
    }

    function isCachedModel(provider, model) {
        return cachedModelsForProvider(provider).includes(model);
    }

    function modelOptionsForProvider(provider) {
        const config = providerConfig(provider) || AI_PROVIDERS[0];
        const ids = [
            ...config.curatedModels,
            ...cachedModelsForProvider(config.id),
            modelForProvider(config.id),
            screenshotModelForProvider(config.id)
        ];
        return Array.from(new Set(ids.map(model => String(model || '').trim()).filter(Boolean)));
    }

    function setElementHidden(element, isHidden) {
        element?.classList.toggle('hidden', Boolean(isHidden));
    }

    function setAiSettingsFeedback(message, tone = 'muted', { autoClear = true } = {}) {
        const feedback = byId('settings-ai-feedback');
        if (!feedback) return;
        if (aiSettingsFeedbackTimer) {
            clearTimeout(aiSettingsFeedbackTimer);
            aiSettingsFeedbackTimer = null;
        }
        feedback.textContent = message;
        feedback.dataset.tone = tone;
        if (message && autoClear) {
            aiSettingsFeedbackTimer = setTimeout(() => {
                feedback.textContent = '';
                feedback.dataset.tone = 'muted';
                aiSettingsFeedbackTimer = null;
            }, 2600);
        }
    }

    function clearAiModelRefreshSuccessTimer() {
        if (!aiModelRefreshSuccessTimer) return;
        global.clearTimeout?.(aiModelRefreshSuccessTimer);
        aiModelRefreshSuccessTimer = null;
    }

    function scheduleAiModelRefreshSuccessClear(provider) {
        clearAiModelRefreshSuccessTimer();
        if (typeof global.setTimeout !== 'function') return;
        aiModelRefreshSuccessTimer = global.setTimeout(() => {
            aiModelRefreshSuccessTimer = null;
            if (aiModelRefreshState.provider === provider && aiModelRefreshState.status === 'success') {
                aiModelRefreshState = { provider: '', status: 'idle', message: '', count: 0, refreshedAt: '' };
                renderAiModelPickers();
            }
        }, AI_MODEL_REFRESH_SUCCESS_MS);
    }

    function clearAiModelRefreshSuccessState() {
        clearAiModelRefreshSuccessTimer();
        if (aiModelRefreshState.status === 'success') {
            aiModelRefreshState = { provider: '', status: 'idle', message: '', count: 0, refreshedAt: '' };
        }
    }

    function resetAiModelRefreshState(provider = '') {
        clearAiModelRefreshSuccessTimer();
        if (!provider || aiModelRefreshState.provider === provider) {
            aiModelRefreshState = { provider: '', status: 'idle', message: '', count: 0, refreshedAt: '' };
        }
        if (!provider || aiModelRefreshConfirm.provider === provider) {
            aiModelRefreshConfirm = { picker: '', provider: '' };
        }
    }

    async function saveAiSettings(partial) {
        Object.assign(global.state.settings, partial);
        Object.entries(partial).forEach(([key, value]) => {
            if (value === undefined || value === null) return;
            if ([
                'aiProvider',
                'aiOpenAIModel',
                'aiGoogleModel',
                'aiAnthropicModel',
                'aiOpenRouterModel',
                'aiScreenshotProvider',
                'aiScreenshotSummariesEnabled',
                'aiScreenshotFrequencyPreset',
                'aiScreenshotDailyCap',
                'aiScreenshotTimeoutSeconds',
                'aiScreenshotModelMode',
                'aiScreenshotOpenAIModel',
                'aiScreenshotGoogleModel',
                'aiScreenshotAnthropicModel',
                'aiScreenshotOpenRouterModel'
            ].includes(key)) {
                global.localStorage?.setItem?.(key, String(value));
            }
        });
        if (!global.OrielData?.isNative) return global.state.settings;
        try {
            const updated = await global.OrielData.request('ai.settings.update', partial);
            Object.assign(global.state.settings, updated);
            return updated;
        } catch (error) {
            console.error('Error saving AI settings:', error);
            setAiSettingsFeedback('Could not save AI settings.', 'error');
            return global.state.settings;
        }
    }

    async function resolveAiProviderSelection(status = aiKeyStatus) {
        if (selectedProvider()) return selectedProvider();
        const configuredProviders = providerIds().filter(provider => Boolean(status?.[provider]));
        if (configuredProviders.length !== 1) return '';
        const provider = configuredProviders[0];
        await saveAiSettings({ aiProvider: provider });
        return provider;
    }

    function renderAiProviderCards() {
        const provider = selectedKeyProvider();
        AI_PROVIDERS.forEach(config => {
            const card = global.document?.querySelector?.(`[data-settings-ai-provider="${config.id}"]`);
            const keyState = byId(`settings-ai-provider-${config.id}-key-state`);
            const hasKey = Boolean(aiKeyStatus[config.id]);
            card?.classList.toggle('is-selected', provider === config.id);
            card?.setAttribute('aria-checked', String(provider === config.id));
            if (keyState) {
                keyState.dataset.state = hasKey ? 'saved' : 'missing';
                if (hasKey) {
                    keyState.textContent = '';
                    keyState.innerHTML = '<i class="ph ph-check" aria-hidden="true"></i>';
                    keyState.setAttribute('aria-label', 'Key saved');
                    keyState.setAttribute('title', 'Key saved');
                } else {
                    keyState.innerHTML = '';
                    keyState.textContent = 'No key';
                    keyState.removeAttribute?.('aria-label');
                    keyState.removeAttribute?.('title');
                }
            }
        });
    }

    function renderAiSettingsStatus() {
        const unconfiguredStatus = byId('ai-unconfigured-status');
        const configuredCount = providerIds().filter(candidate => Boolean(aiKeyStatus[candidate])).length;
        if (unconfiguredStatus) {
            unconfiguredStatus.classList.toggle('hidden', configuredCount > 0);
        }
    }

    function renderAiKeyControls({ resetKey = false } = {}) {
        const provider = selectedKeyProvider();
        const hasProvider = Boolean(provider);
        const hasKey = hasProvider && Boolean(aiKeyStatus[provider]);
        const isEditing = hasKey && aiKeyEditProvider === provider;
        const keyInput = byId('settings-ai-api-key-input');
        const editButton = byId('settings-ai-key-edit-button');
        const saveButton = byId('settings-ai-key-save-button');
        const saveLabel = byId('settings-ai-key-save-label') || saveButton?.querySelector?.('span');
        const cancelButton = byId('settings-ai-key-cancel-button');
        const deleteButton = byId('settings-ai-key-delete-button');

        if (aiKeyEditProvider && aiKeyEditProvider !== provider) {
            aiKeyEditProvider = null;
        }

        if (keyInput) {
            keyInput.disabled = !hasProvider || (hasKey && !isEditing);
            keyInput.placeholder = !hasProvider
                ? 'Choose provider first'
                : (hasKey && !isEditing ? '' : (isEditing ? 'Paste new API key' : 'Paste API key'));
            if (resetKey || (hasKey && !isEditing)) {
                keyInput.value = hasKey && !isEditing ? '********' : '';
            }
        }

        setElementHidden(editButton, !hasKey || isEditing);
        setElementHidden(saveButton, !hasProvider || (hasKey && !isEditing));
        setElementHidden(cancelButton, !isEditing);
        setElementHidden(deleteButton, !hasKey || isEditing);
        if (saveLabel) saveLabel.textContent = isEditing ? 'Save new key' : 'Save key';
    }

    function setAiKeyEditMode(isEditing) {
        const provider = selectedKeyProvider();
        aiKeyEditProvider = isEditing && provider ? provider : null;
        syncAiSettingsControls({ resetKey: true });
        if (isEditing) byId('settings-ai-api-key-input')?.focus?.({ preventScroll: true });
    }

    function modelOptionSource(provider, model, { isCustomSearch = false } = {}) {
        if (isCustomSearch) return 'Custom';
        if (isCuratedModel(provider, model)) return 'Model';
        if (isCachedModel(provider, model)) return 'Fetched';
        return 'Custom';
    }

    function modelPickerIds(picker) {
        return MODEL_PICKERS[picker] || MODEL_PICKERS.ask;
    }

    function providerForModelPicker(picker) {
        return picker === 'screenshot' ? selectedScreenshotProvider() : selectedProvider();
    }

    function selectedModelForPicker(picker, provider) {
        return picker === 'screenshot' ? screenshotModelForProvider(provider) : modelForProvider(provider);
    }

    function settingKeyForModelPicker(picker, config) {
        return picker === 'screenshot' ? config.screenshotSettingKey : config.settingKey;
    }

    function setAiModelPickerOpen(picker, isOpen) {
        const ids = modelPickerIds(picker);
        Object.entries(MODEL_PICKERS).forEach(([candidate, candidateIds]) => {
            if (candidate === picker) return;
            byId(candidateIds.menu)?.classList.add('hidden');
            byId(candidateIds.button)?.setAttribute('aria-expanded', 'false');
        });

        const menu = byId(ids.menu);
        const button = byId(ids.button);
        menu?.classList.toggle('hidden', !isOpen);
        button?.setAttribute('aria-expanded', String(Boolean(isOpen)));
        if (!isOpen && aiModelRefreshConfirm.picker === picker) {
            aiModelRefreshConfirm = { picker: '', provider: '' };
        }
        if (isOpen) {
            const search = byId(ids.search);
            if (search) search.value = '';
            renderModelOptions(picker);
            search?.focus?.({ preventScroll: true });
        }
        renderAiModelPickers();
    }

    function renderAiModelPicker() {
        renderAiModelPickers();
    }

    function renderAiModelPickers() {
        renderModelPicker('ask');
        renderModelPicker('screenshot');
    }

    function renderModelPicker(picker) {
        const ids = modelPickerIds(picker);
        const provider = providerForModelPicker(picker);
        const label = byId(ids.label);
        const button = byId(ids.button);
        const refreshButton = byId(ids.refreshButton);
        const refreshIcon = refreshButton?.querySelector?.('i');
        const refreshLabel = byId(ids.refreshLabel) || refreshButton?.querySelector?.('span');
        const refreshConfirm = byId(ids.confirm);
        const refreshConfirmText = byId(ids.confirmText);
        const refreshConfirmButton = byId(ids.confirmButton);
        const refreshCancelButton = byId(ids.cancelButton);
        const meta = byId(ids.meta);
        const selected = provider ? selectedModelForPicker(picker, provider) : '';
        const stateApplies = Boolean(provider) && aiModelRefreshState.provider === provider;
        if (aiModelRefreshConfirm.picker === picker && aiModelRefreshConfirm.provider !== provider) {
            aiModelRefreshConfirm = { picker: '', provider: '' };
        }
        if (label) label.textContent = selected || 'Choose provider first';
        if (button) button.disabled = !provider;

        const isRefreshing = stateApplies && aiModelRefreshState.status === 'loading';
        const isSuccess = stateApplies && aiModelRefreshState.status === 'success' && aiModelRefreshState.count > 0;
        const isConfirming = Boolean(provider) && aiModelRefreshConfirm.picker === picker && aiModelRefreshConfirm.provider === provider;
        if (refreshButton) {
            refreshButton.disabled = !provider || isRefreshing;
            refreshButton.classList.toggle('is-loading', isRefreshing);
            refreshButton.classList.toggle('is-success', isSuccess);
        }
        if (refreshIcon) {
            refreshIcon.className = isSuccess ? 'ph ph-check' : 'ph ph-arrows-clockwise';
            refreshIcon.classList.toggle('is-loading', isRefreshing);
        }
        if (refreshLabel) {
            refreshLabel.textContent = isRefreshing
                ? 'Refreshing...'
                : (isSuccess ? 'Models refreshed' : 'Refresh from provider...');
        }
        setElementHidden(refreshConfirm, !isConfirming);
        if (refreshConfirmText && isConfirming) {
            refreshConfirmText.textContent = `Refresh ${providerLabel(provider)} models now? This will contact the provider API once.`;
        }
        if (refreshConfirmButton) refreshConfirmButton.disabled = isRefreshing;
        if (refreshCancelButton) refreshCancelButton.disabled = isRefreshing;

        if (meta) {
            meta.dataset.tone = 'muted';
            if (stateApplies && aiModelRefreshState.status === 'loading') {
                meta.textContent = 'Refreshing models...';
            } else if (stateApplies && aiModelRefreshState.status === 'error') {
                meta.textContent = aiModelRefreshState.message || 'Could not refresh models.';
                meta.dataset.tone = 'error';
            } else if (stateApplies && aiModelRefreshState.status === 'success' && aiModelRefreshState.count === 0) {
                meta.textContent = 'No compatible models returned.';
            } else {
                meta.textContent = '';
            }
        }
        renderModelOptions(picker);
    }

    function renderModelOptions(picker) {
        const ids = modelPickerIds(picker);
        const list = byId(ids.list);
        if (!list) return;
        const provider = providerForModelPicker(picker) || 'openai';
        const search = String(byId(ids.search)?.value || '').trim();
        const selected = selectedModelForPicker(picker, provider);
        const lowerSearch = search.toLowerCase();
        const options = modelOptionsForProvider(provider)
            .filter(model => !lowerSearch || model.toLowerCase().includes(lowerSearch));

        const exactSearchMatch = search && modelOptionsForProvider(provider).some(model => model.toLowerCase() === lowerSearch);
        if (search && !exactSearchMatch) options.unshift(search);

        if (options.length === 0) {
            list.innerHTML = '<div class="ai-model-option" aria-disabled="true">No matching models</div>';
            return;
        }

        list.innerHTML = options.map(model => {
            const isSelected = model === selected;
            const source = modelOptionSource(provider, model, { isCustomSearch: search && model === search && !exactSearchMatch });
            return `
                <button type="button" class="ai-model-option${isSelected ? ' is-selected' : ''}" data-ai-model="${escapeHtml(model)}" role="option" aria-selected="${String(isSelected)}">
                    <span>${escapeHtml(model)}</span>
                    <span class="ai-model-option-source">${source}</span>
                </button>
            `;
        }).join('');

        list.querySelectorAll?.('[data-ai-model]')?.forEach(button => {
            button.addEventListener('click', () => selectModelForPicker(picker, button.dataset.aiModel));
        });
    }

    async function selectModelForPicker(picker, model) {
        const provider = providerForModelPicker(picker);
        const config = providerConfig(provider);
        const value = String(model || '').trim();
        if (!config || !value) return;
        await saveAiSettings({ [settingKeyForModelPicker(picker, config)]: value });
        setAiModelPickerOpen(picker, false);
        syncAiSettingsControls();
        global.renderAiSidebar?.();
    }

    function requestAiModelRefreshConfirmation(picker = 'ask') {
        clearAiModelRefreshSuccessState();
        const provider = providerForModelPicker(picker);
        if (!provider) {
            aiModelRefreshConfirm = { picker: '', provider: '' };
            aiModelRefreshState = { provider: '', status: 'error', message: 'Choose a provider first.', count: 0, refreshedAt: '' };
            setAiModelPickerOpen(picker, true);
            return;
        }
        if (!global.OrielData?.isNative) {
            aiModelRefreshConfirm = { picker: '', provider: '' };
            aiModelRefreshState = { provider, status: 'error', message: 'Model refresh requires Oriel.app.', count: 0, refreshedAt: '' };
            setAiModelPickerOpen(picker, true);
            return;
        }
        if (!aiKeyStatus[provider]) {
            aiModelRefreshConfirm = { picker: '', provider: '' };
            aiModelRefreshState = { provider, status: 'error', message: 'Save a key for this provider first.', count: 0, refreshedAt: '' };
            setAiModelPickerOpen(picker, true);
            return;
        }

        aiModelRefreshConfirm = { picker, provider };
        setAiModelPickerOpen(picker, true);
    }

    function cancelAiModelRefreshConfirmation(picker = 'ask') {
        if (aiModelRefreshConfirm.picker === picker) {
            aiModelRefreshConfirm = { picker: '', provider: '' };
        }
        renderAiModelPickers();
    }

    async function refreshAiModelsForSelectedProvider() {
        return refreshAiModelsForPicker('ask');
    }

    async function refreshAiModelsForPicker(picker = 'ask') {
        const provider = providerForModelPicker(picker);
        if (!provider || !global.OrielData?.isNative || !aiKeyStatus[provider]) {
            requestAiModelRefreshConfirmation(picker);
            return;
        }
        if (aiModelRefreshConfirm.picker !== picker || aiModelRefreshConfirm.provider !== provider) {
            requestAiModelRefreshConfirmation(picker);
            return;
        }

        clearAiModelRefreshSuccessTimer();
        aiModelRefreshConfirm = { picker: '', provider: '' };
        aiModelRefreshState = { provider, status: 'loading', message: '', count: 0, refreshedAt: '' };
        renderAiModelPickers();
        try {
            const response = await global.OrielData.request('ai.models.list', { provider });
            const models = Array.isArray(response?.models) ? response.models.filter(Boolean) : [];
            const mergedModels = Array.from(new Set([...cachedModelsForProvider(provider), ...models].map(model => String(model || '').trim()).filter(Boolean)));
            const refreshedAt = response?.refreshedAt || new Date().toISOString();
            aiModelCache[provider] = {
                models: mergedModels,
                refreshedAt
            };
            aiModelRefreshState = {
                provider,
                status: 'success',
                message: models.length > 0 ? 'Model list refreshed.' : 'No compatible models returned.',
                count: models.length,
                refreshedAt
            };
            saveAiModelCache();
            if (models.length > 0) scheduleAiModelRefreshSuccessClear(provider);
            renderAiModelPickers();
        } catch (error) {
            console.error('Error refreshing AI models:', error);
            aiModelRefreshState = {
                provider,
                status: 'error',
                message: error?.message || 'Could not refresh models.',
                count: 0,
                refreshedAt: ''
            };
            renderAiModelPickers();
        }
    }

    async function refreshAiKeyStatus() {
        if (!global.OrielData?.isNative) {
            aiKeyStatus = { openai: false, google: false, anthropic: false, openrouter: false };
            return aiKeyStatus;
        }
        try {
            aiKeyStatus = await global.OrielData.request('ai.keys.status', {});
        } catch (error) {
            console.error('Error loading AI key status:', error);
            aiKeyStatus = { openai: false, google: false, anthropic: false, openrouter: false };
            setAiSettingsFeedback('Could not read key status.', 'error');
        }
        return aiKeyStatus;
    }

    async function saveAiKey() {
        const provider = selectedKeyProvider();
        const apiKey = byId('settings-ai-api-key-input')?.value?.trim() || '';
        if (!provider || !apiKey) {
            setAiSettingsFeedback('Choose a provider and paste a key.', 'error');
            return;
        }
        if (!global.OrielData?.isNative) {
            setAiSettingsFeedback('Keychain storage is available in Oriel.app.', 'error');
            return;
        }
        try {
            aiKeyStatus = await global.OrielData.request('ai.keys.save', { provider, apiKey });
            aiKeyEditProvider = null;
            resetAiModelRefreshState(provider);
            await resolveAiProviderSelection(aiKeyStatus);
            byId('settings-ai-api-key-input').value = '';
            setAiSettingsFeedback('Key saved in Keychain.', 'success');
            syncAiSettingsControls({ resetKey: true });
            global.renderAiSidebar?.();
        } catch (error) {
            console.error('Error saving AI key:', error);
            setAiSettingsFeedback('Could not save API key.', 'error');
        }
    }

    async function deleteAiKey() {
        const provider = selectedKeyProvider();
        if (!provider || !global.OrielData?.isNative) return;

        const removeKey = async () => {
            try {
                aiKeyStatus = await global.OrielData.request('ai.keys.delete', { provider });
                aiKeyEditProvider = null;
                resetAiModelRefreshState(provider);
                setAiSettingsFeedback('Key removed.', 'success');
                syncAiSettingsControls({ resetKey: true });
                global.renderAiSidebar?.();
            } catch (error) {
                console.error('Error deleting AI key:', error);
                setAiSettingsFeedback('Could not remove API key.', 'error');
            }
        };

        if (typeof global.showCustomConfirm === 'function') {
            return global.showCustomConfirm({
                title: `Remove ${providerLabel(provider)} API key?`,
                message: `Remove the saved ${providerLabel(provider)} API key from macOS Keychain?`,
                actionText: 'Remove key',
                actionClass: 'button-secondary',
                onConfirm: removeKey
            });
        }

        const confirmed = typeof global.confirm === 'function'
            ? global.confirm(`Remove the saved ${providerLabel(provider)} API key from Keychain?`)
            : true;
        if (confirmed) await removeKey();
    }

    function normalizeFrequency(value) {
        return ['low', 'balanced', 'high'].includes(value) ? value : 'balanced';
    }

    function normalizeDailyCap(value) {
        const cap = Number.parseInt(value, 10);
        return Number.isFinite(cap) ? Math.min(1000, Math.max(1, cap)) : 100;
    }

    function normalizeTimeout(value) {
        const seconds = Number.parseInt(value, 10);
        return Number.isFinite(seconds) ? Math.min(60, Math.max(5, seconds)) : 20;
    }

    function normalizeScreenshotProvider(value) {
        return providerConfig(value) ? value : (selectedProvider() || 'openai');
    }

    function syncAskProviderControl() {
        const providerSelect = byId('settings-ai-ask-provider');
        if (providerSelect) {
            providerSelect.value = selectedProvider() || 'openai';
            global.refreshCustomSelects?.(providerSelect);
        }
    }

    function syncScreenshotProviderControl() {
        const providerSelect = byId('settings-ai-screenshot-provider');
        if (providerSelect) {
            providerSelect.value = selectedScreenshotProvider();
            global.refreshCustomSelects?.(providerSelect);
        }
    }

    function renderScreenshotSettingsControls() {
        const enabled = byId('settings-ai-screenshot-enabled');
        const frequency = byId('settings-ai-screenshot-frequency');
        const dailyCap = byId('settings-ai-screenshot-daily-cap');
        const timeout = byId('settings-ai-screenshot-timeout');
        if (enabled) enabled.checked = Boolean(global.state?.settings?.aiScreenshotSummariesEnabled);
        if (frequency) {
            frequency.value = normalizeFrequency(global.state?.settings?.aiScreenshotFrequencyPreset || 'balanced');
            global.refreshCustomSelects?.(frequency);
        }
        if (dailyCap) dailyCap.value = normalizeDailyCap(global.state?.settings?.aiScreenshotDailyCap || 100);
        if (timeout) timeout.value = normalizeTimeout(global.state?.settings?.aiScreenshotTimeoutSeconds || 20);
        syncScreenshotProviderControl();
    }

    function syncAiSettingsControls({ resetKey = false } = {}) {
        syncAskProviderControl();
        renderAiProviderCards();
        renderAiKeyControls({ resetKey });
        renderScreenshotSettingsControls();
        renderAiModelPickers();
        renderAiSettingsStatus();
    }

    async function saveScreenshotSettingFromControl(event) {
        const target = event?.target;
        if (!target) return;
        const partial = {};
        if (target.id === 'settings-ai-screenshot-enabled') {
            partial.aiScreenshotSummariesEnabled = Boolean(target.checked);
            if (target.checked && !providerConfig(global.state?.settings?.aiScreenshotProvider)) {
                partial.aiScreenshotProvider = selectedScreenshotProvider();
            }
        } else if (target.id === 'settings-ai-screenshot-frequency') {
            partial.aiScreenshotFrequencyPreset = normalizeFrequency(target.value);
        } else if (target.id === 'settings-ai-screenshot-daily-cap') {
            partial.aiScreenshotDailyCap = normalizeDailyCap(target.value);
        } else if (target.id === 'settings-ai-screenshot-timeout') {
            partial.aiScreenshotTimeoutSeconds = normalizeTimeout(target.value);
        } else if (target.id === 'settings-ai-screenshot-provider') {
            partial.aiScreenshotProvider = normalizeScreenshotProvider(target.value);
        }
        await saveAiSettings(partial);
        if (partial.aiScreenshotProvider) resetAiModelRefreshState();
        syncAiSettingsControls();
    }

    async function saveAskProviderFromControl(event) {
        const provider = providerConfig(event?.target?.value) ? event.target.value : 'openai';
        resetAiModelRefreshState();
        await saveAiSettings({ aiProvider: provider });
        syncAiSettingsControls();
        global.renderAiSidebar?.();
    }

    async function runTestScreenshotAnalysis() {
        const provider = selectedScreenshotProvider();
        if (!provider) {
            setAiSettingsFeedback('Choose a provider first.', 'error');
            return;
        }
        if (!aiKeyStatus[provider]) {
            setAiSettingsFeedback('Save a key for this provider first.', 'error');
            return;
        }
        if (!global.OrielData?.isNative) {
            setAiSettingsFeedback('Test screenshot analysis requires Oriel.app.', 'error');
            return;
        }
        try {
            setAiSettingsFeedback('Testing screenshot analysis...', 'muted', { autoClear: false });
            await global.OrielData.request('ai.screenshotSummary.test', {
                provider,
                model: selectedScreenshotModel(),
                timeoutSeconds: normalizeTimeout(global.state?.settings?.aiScreenshotTimeoutSeconds || 20)
            });
            setAiSettingsFeedback('Screenshot analysis test completed.', 'success');
        } catch (error) {
            console.error('Error testing screenshot analysis:', error);
            setAiSettingsFeedback(error?.message || 'Screenshot analysis test failed.', 'error');
        }
    }

    async function refreshAiSettingsStatus() {
        await refreshAiKeyStatus();
        await resolveAiProviderSelection(aiKeyStatus);
        syncAiSettingsControls({ resetKey: true });
        return getSelectedAiProviderAndModel();
    }

    function getSelectedAiProviderAndModel() {
        const provider = selectedProvider();
        return {
            provider,
            providerLabel: providerLabel(provider),
            model: provider ? selectedModel() : '',
            screenshotProvider: selectedScreenshotProvider(),
            screenshotProviderLabel: providerLabel(selectedScreenshotProvider()),
            screenshotModel: selectedScreenshotProvider() ? selectedScreenshotModel() : '',
            hasKey: Boolean(provider && aiKeyStatus[provider])
        };
    }

    function aiProviderHasSavedKey(provider) {
        return Boolean(aiKeyStatus[provider]);
    }

    function hasAnyAiProviderKey() {
        return providerIds().some(provider => Boolean(aiKeyStatus[provider]));
    }

    function bindAiSettings() {
        if (aiInitialized || !global.document) return;
        aiInitialized = true;

        global.document.querySelectorAll?.('[data-settings-ai-provider]')?.forEach(button => {
            button.addEventListener('click', () => {
                const provider = button.dataset.settingsAiProvider;
                if (!providerConfig(provider)) return;
                aiKeyProvider = provider;
                aiKeyEditProvider = null;
                setAiSettingsFeedback('', 'muted', { autoClear: false });
                syncAiSettingsControls({ resetKey: true });
            });
        });
        byId('settings-ai-ask-provider')?.addEventListener('change', saveAskProviderFromControl);
        Object.keys(MODEL_PICKERS).forEach(picker => {
            const ids = modelPickerIds(picker);
            byId(ids.button)?.addEventListener('click', event => {
                event.stopPropagation();
                const menu = byId(ids.menu);
                setAiModelPickerOpen(picker, menu?.classList.contains('hidden'));
            });
            byId(ids.search)?.addEventListener('input', () => renderModelOptions(picker));
            byId(ids.search)?.addEventListener('keydown', event => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    selectModelForPicker(picker, event.target.value);
                } else if (event.key === 'Escape') {
                    setAiModelPickerOpen(picker, false);
                }
            });
            byId(ids.refreshButton)?.addEventListener('click', () => requestAiModelRefreshConfirmation(picker));
            byId(ids.confirmButton)?.addEventListener('click', () => refreshAiModelsForPicker(picker));
            byId(ids.cancelButton)?.addEventListener('click', () => cancelAiModelRefreshConfirmation(picker));
        });
        global.document.addEventListener?.('click', event => {
            if (event.target?.closest?.('.ai-model-picker')) return;
            Object.keys(MODEL_PICKERS).forEach(picker => setAiModelPickerOpen(picker, false));
        });
        byId('settings-ai-key-edit-button')?.addEventListener('click', () => setAiKeyEditMode(true));
        byId('settings-ai-key-cancel-button')?.addEventListener('click', () => setAiKeyEditMode(false));
        byId('settings-ai-key-save-button')?.addEventListener('click', saveAiKey);
        byId('settings-ai-key-delete-button')?.addEventListener('click', deleteAiKey);
        [
            'settings-ai-screenshot-enabled',
            'settings-ai-screenshot-provider',
            'settings-ai-screenshot-frequency',
            'settings-ai-screenshot-daily-cap',
            'settings-ai-screenshot-timeout'
        ].forEach(id => byId(id)?.addEventListener('change', saveScreenshotSettingFromControl));
        byId('settings-ai-screenshot-test-button')?.addEventListener('click', runTestScreenshotAnalysis);

        syncAiSettingsControls({ resetKey: true });
    }

    function initAiSettings() {
        bindAiSettings();
        return refreshAiSettingsStatus();
    }

    global.DEFAULT_OPENAI_MODEL = DEFAULT_OPENAI_MODEL;
    global.DEFAULT_GOOGLE_MODEL = DEFAULT_GOOGLE_MODEL;
    global.DEFAULT_ANTHROPIC_MODEL = DEFAULT_ANTHROPIC_MODEL;
    global.DEFAULT_OPENROUTER_MODEL = DEFAULT_OPENROUTER_MODEL;
    global.AI_PROVIDERS = AI_PROVIDERS;
    global.resolveAiProviderSelection = resolveAiProviderSelection;
    global.refreshAiModelsForSelectedProvider = refreshAiModelsForSelectedProvider;
    global.refreshAiSettingsStatus = refreshAiSettingsStatus;
    global.getSelectedAiProviderAndModel = getSelectedAiProviderAndModel;
    global.aiProviderHasSavedKey = aiProviderHasSavedKey;
    global.hasAnyAiProviderKey = hasAnyAiProviderKey;
    global.initAiSettings = initAiSettings;
    window.refreshAiSettingsStatus = refreshAiSettingsStatus;
    window.getSelectedAiProviderAndModel = getSelectedAiProviderAndModel;
})(window);
