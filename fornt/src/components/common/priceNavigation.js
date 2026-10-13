// Enter moves down the same column within this table and saves through onBlur.
export const handlePriceRowEnter = (event) => {
    if (event.key !== 'Enter' || event.nativeEvent?.isComposing) return;
    event.preventDefault();
    const input = event.currentTarget;
    const nextInput = input.closest('tr')?.nextElementSibling?.querySelector(
        `input[data-price-column="${input.dataset.priceColumn}"]`
    );
    if (nextInput) {
        nextInput.focus();
        nextInput.select();
    } else {
        input.blur();
    }
};
