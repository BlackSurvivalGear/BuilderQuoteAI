/* BuilderQuoteAI - Premium JS Interaction Engine */

document.addEventListener('DOMContentLoaded', () => {
    // 1. Initialize Lucide Icons
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }

    // 2. Dynamic Year Injection
    const yearSpan = document.getElementById('current-year');
    if (yearSpan) {
        yearSpan.textContent = new Date().getFullYear();
    }

    // 3. Mobile Navigation Menu Toggle
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const mobileMenu = document.getElementById('mobile-menu');
    const menuIcon = document.getElementById('menu-icon');
    const closeIcon = document.getElementById('close-icon');

    if (mobileMenuBtn && mobileMenu) {
        mobileMenuBtn.addEventListener('click', () => {
            const isExpanded = mobileMenuBtn.getAttribute('aria-expanded') === 'true';
            mobileMenuBtn.setAttribute('aria-expanded', !isExpanded);
            mobileMenu.classList.toggle('hidden');

            if (menuIcon && closeIcon) {
                menuIcon.classList.toggle('hidden');
                closeIcon.classList.toggle('hidden');
            }
        });

        // Close mobile menu on click of nav links
        const mobileLinks = document.querySelectorAll('.mobile-nav-link');
        mobileLinks.forEach(link => {
            link.addEventListener('click', () => {
                mobileMenu.classList.add('hidden');
                mobileMenuBtn.setAttribute('aria-expanded', 'false');
                if (menuIcon && closeIcon) {
                    menuIcon.classList.remove('hidden');
                    closeIcon.classList.add('hidden');
                }
            });
        });
    }

    // 4. Monthly vs Annual Billing Toggle logic
    const billingToggle = document.getElementById('billing-toggle');
    const toggleKnob = document.getElementById('toggle-knob');
    const labelMonthly = document.getElementById('label-monthly');
    const labelAnnual = document.getElementById('label-annual');

    // Plan Price spans
    const priceStarter = document.getElementById('price-starter');
    const priceProfessional = document.getElementById('price-professional');

    let isAnnual = false;

    if (billingToggle && toggleKnob) {
        billingToggle.addEventListener('click', () => {
            isAnnual = !isAnnual;
            billingToggle.setAttribute('aria-checked', isAnnual);

            // Toggle knob transitions
            if (isAnnual) {
                toggleKnob.classList.replace('translate-x-0', 'translate-x-7');
                labelAnnual.classList.replace('text-gray-400', 'text-white');
                labelMonthly.classList.replace('text-white', 'text-gray-400');

                // Update prices with 30% discount
                animatePriceChange(priceStarter, 55);
                animatePriceChange(priceProfessional, 139);
            } else {
                toggleKnob.classList.replace('translate-x-7', 'translate-x-0');
                labelAnnual.classList.replace('text-white', 'text-gray-400');
                labelMonthly.classList.replace('text-gray-400', 'text-white');

                // Reset to standard prices
                animatePriceChange(priceStarter, 79);
                animatePriceChange(priceProfessional, 199);
            }
        });
    }

    // Helper to animate pricing change smoothly
    function animatePriceChange(element, targetPrice) {
        if (!element) return;
        element.style.opacity = '0';
        element.style.transform = 'translateY(-8px)';

        setTimeout(() => {
            element.textContent = targetPrice;
            element.style.opacity = '1';
            element.style.transform = 'translateY(0)';
        }, 150);
    }

    // 5. Initialize Estimator Default Calculation on load
    updateEstimatorValues();
});

/* 6. Fallback Logo Display Logic */
// These globally accessible functions are invoked if the BuilderQuoteAI.png assets are missing
function handleLogoError() {
    const container = document.getElementById('logo-container');
    if (container) {
        container.innerHTML = `
            <span class="text-xl font-extrabold tracking-tight text-white flex items-center gap-2">
                <span class="text-brand-gold font-black bg-brand-gold-muted px-2 py-1 rounded-lg border border-brand-gold-border text-lg font-mono">B</span>
                BuilderQuote<span class="text-brand-gold">AI</span>
            </span>
        `;
    }
}

function handleFooterLogoError() {
    const container = document.getElementById('footer-logo-container');
    if (container) {
        container.innerHTML = `
            <span class="text-lg font-bold tracking-tight text-white flex items-center gap-1.5 justify-center md:justify-start">
                <span class="text-brand-gold font-extrabold bg-brand-gold-muted px-1.5 py-0.5 rounded border border-brand-gold-border text-sm font-mono">B</span>
                BuilderQuote<span class="text-brand-gold">AI</span>
            </span>
        `;
    }
}

/* 7. Dynamic Real-Time Interactive Estimator Widget */
let activeGrade = 'Premium';
let activeRate = 1850;

function updateEstimatorValues() {
    const areaSlider = document.getElementById('area-slider');
    const areaVal = document.getElementById('area-val');
    const estimatedTotal = document.getElementById('estimated-total');

    if (!areaSlider || !areaVal || !estimatedTotal) return;

    const area = parseInt(areaSlider.value);
    areaVal.textContent = area;

    // Calculate total project value based on area & selected grade rate per sq meter
    const rawValuation = area * activeRate;

    // Format to local currency GBP
    const formatter = new Intl.NumberFormat('en-GB', {
        style: 'currency',
        currency: 'GBP',
        maximumFractionDigits: 0
    });

    estimatedTotal.textContent = formatter.format(rawValuation);
}

function setEstimateGrade(gradeName, ratePerSqMeter) {
    activeGrade = gradeName;
    activeRate = ratePerSqMeter;

    const gradeVal = document.getElementById('grade-val');
    if (gradeVal) {
        gradeVal.textContent = gradeName;
    }

    // Update active highlight classes on option buttons
    const gradeButtons = document.querySelectorAll('.grade-btn');
    gradeButtons.forEach(btn => {
        if (btn.textContent.trim() === gradeName) {
            btn.className = "grade-btn border border-brand-gold/60 bg-brand-gold-muted py-1 text-[10px] font-bold rounded text-brand-gold transition-all";
        } else {
            btn.className = "grade-btn border border-brand-glass-border bg-brand-matte py-1 text-[10px] font-semibold rounded text-gray-400 hover:text-white hover:border-gray-500 transition-all";
        }
    });

    updateEstimatorValues();
}

/* 8. Interactive Document Scan Simulator & Demo Action Animations */
let scanInterval = null;

function startSurveyScanning() {
    const demoBox = document.getElementById('demo-box');
    const scanningOverlay = document.getElementById('scanning-overlay');
    const scanningProgressBar = document.getElementById('scanning-progress-bar');
    const scanningStepText = document.getElementById('scanning-step-text');
    const scanningSubText = document.getElementById('scanning-sub-text');
    const statusText = document.getElementById('calculation-status');

    if (!demoBox || !scanningOverlay || !scanningProgressBar || !statusText) return;

    // Guard against multiple concurrent scan sessions
    if (scanInterval) return;

    // Clear and prepare layout
    scanningOverlay.className = "absolute inset-0 bg-brand-matte/90 flex flex-col items-center justify-center p-4 transition-all duration-300 scale-100 opacity-100 pointer-events-auto";
    demoBox.classList.add('scanning-glow');
    scanningProgressBar.style.width = '0%';
    statusText.textContent = "Processing...";
    statusText.className = "text-[11px] text-yellow-400 font-semibold animate-pulse";

    let step = 0;
    const steps = [
        { progress: '15%', main: 'Uploading Architectural PDF Blueprint...', sub: 'Establishing drawing canvas matrix' },
        { progress: '38%', main: 'Isolating structural outer boundary walls...', sub: 'Detecting 240mm masonry layers' },
        { progress: '65%', main: 'Mapping partitions, windows, and doors...', sub: 'Calculating raw timber studs & frames' },
        { progress: '85%', main: 'Extracting Bill of Quantities (BOQ)...', sub: 'NRM2 compliant take-off schema mapped' },
        { progress: '100%', main: 'Finalizing Local Labor Rates indexing...', sub: 'Calculation compiled successfully!' }
    ];

    scanInterval = setInterval(() => {
        if (step < steps.length) {
            const currentStep = steps[step];
            scanningProgressBar.style.width = currentStep.progress;
            scanningStepText.textContent = currentStep.main;
            scanningSubText.textContent = currentStep.sub;
            step++;
        } else {
            // Scan Complete
            clearInterval(scanInterval);
            scanInterval = null;

            // Trigger success UI transitions
            scanningOverlay.className = "absolute inset-0 bg-brand-matte/90 flex flex-col items-center justify-center p-4 transition-all duration-500 scale-95 opacity-0 pointer-events-none";
            demoBox.classList.remove('scanning-glow');
            statusText.textContent = "Estimation Ready";
            statusText.className = "text-[11px] text-green-400 font-semibold";

            // Trigger success Toast
            showToast('Sovereign Estimator', 'Architectural blueprint parsed. Takeoffs loaded!');
        }
    }, 1200);
}

function triggerDemoAnimation() {
    // Scroll smoothly to estimator section
    const demoBox = document.getElementById('demo-box');
    if (demoBox) {
        demoBox.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // Brief delay before launching simulation
        setTimeout(() => {
            startSurveyScanning();
        }, 800);
    }
}

/* 9. Success Feedback Toast & Form Actions */
function showToast(title, message) {
    const toast = document.getElementById('toast');
    const toastTitle = document.getElementById('toast-title');
    const toastMessage = document.getElementById('toast-message');

    if (!toast || !toastTitle || !toastMessage) return;

    toastTitle.textContent = title;
    toastMessage.textContent = message;

    // Smoothly popup toast
    toast.className = "fixed bottom-8 right-8 z-50 transform translate-y-0 opacity-100 pointer-events-auto transition-all duration-500 ease-out bg-brand-graphite border border-brand-gold shadow-gold-glow rounded-xl px-5 py-4 max-w-sm flex items-start gap-3";

    // Auto-dismiss after 4 seconds
    setTimeout(() => {
        toast.className = "fixed bottom-8 right-8 z-50 transform translate-y-20 opacity-0 pointer-events-none transition-all duration-500 ease-out bg-brand-graphite border border-brand-gold shadow-gold-glow rounded-xl px-5 py-4 max-w-sm flex items-start gap-3";
    }, 4000);
}

function handleFormSubmit(event) {
    event.preventDefault();
    const nameVal = document.getElementById('form-name').value;

    // Simulate API request processing
    showToast('Inquiry Received', `Thank you ${nameVal}! Our Quantity Surveying team will reach out within 15 minutes.`);

    // Reset contact form fields
    const contactForm = document.getElementById('contact-form');
    if (contactForm) {
        contactForm.reset();
    }
}

function subscribePlan(planName) {
    showToast('Plan Selection', `Selected ${planName} Plan. Proceeding to premium Estimator workspace...`);
}
