#include <iostream>
#include "dispense_wheel_logic.h"

void printTestResult(const std::string &testName, bool passed, const std::string &expected, const std::string &actual) {
    std::cout << "Test: " << testName << "\n";
    std::cout << "  Expected: " << expected << "\n";
    std::cout << "  Actual:   " << actual << "\n";
    std::cout << "  Result:   " << (passed ? "PASS ✅" : "FAIL ❌") << "\n\n";
}

// Test initial state of wheel
void test_initial_state() {
    DispenseWheel w;
    std::string slotsStr;
    for (int i = 0; i < 5; i++) slotsStr += std::to_string(w.slots()[i]) + (i < 4 ? "," : "");
    bool passed = (w.windowIndex() == 0);
    printTestResult("Initial windowIndex", passed, "windowIndex=0", "windowIndex=" + std::to_string(w.windowIndex()) + ", slots=[" + slotsStr + "]");
}

// Test single dispense
void test_dispense() {
    DispenseWheel w;
    bool ok = w.dispense();
    std::string slotsStr;
    for (int i = 0; i < 5; i++) slotsStr += std::to_string(w.slots()[i]) + (i < 4 ? "," : "");
    bool passed = ok && (w.windowIndex() != 0);
    printTestResult(
        "Single dispense",
        passed,
        "dispense()=true, windowIndex!=0",
        "dispense()=" + std::string(ok ? "true" : "false") + ", windowIndex=" + std::to_string(w.windowIndex()) + ", slots=[" + slotsStr + "]"
    );
}

// Test dispense until empty
void test_dispense_until_empty() {
    DispenseWheel w;
    bool allDispensesOk = true;
    for (int i = 0; i < 4; i++) {
        bool ok = w.dispense();
        allDispensesOk &= ok;
        std::cout << "  Step " << i+1 << ": dispense()=" << (ok ? "true" : "false") << ", windowIndex=" << int(w.windowIndex()) << "\n";
    }
    bool lastDispenseFail = !w.dispense(); // Should fail now
    bool passed = allDispensesOk && lastDispenseFail;
    printTestResult(
        "Dispense until empty",
        passed,
        "first 4 succeed, 5th fails",
        "5th dispense " + std::string(lastDispenseFail ? "failed as expected" : "succeeded unexpectedly")
    );
}

// Test return item
void test_return() {
    DispenseWheel w;
    w.dispense(); // move windowIndex away from 0
    bool ok = w.returnItem();
    std::string slotsStr;
    for (int i = 0; i < 5; i++) slotsStr += std::to_string(w.slots()[i]) + (i < 4 ? "," : "");
    bool passed = ok;
    printTestResult(
        "Return item",
        passed,
        "returnItem()=true",
        "returnItem()=" + std::string(ok ? "true" : "false") + ", windowIndex=" + std::to_string(w.windowIndex()) + ", slots=[" + slotsStr + "]"
    );
}

// Test advanceIndex logic
void test_advance_index() {
    DispenseWheel w;
    w.dispense();
    uint8_t before = w.windowIndex();
    w.dispense();
    uint8_t after = w.windowIndex();
    bool passed = (before != after);
    printTestResult(
        "Advance index",
        passed,
        "windowIndex should change after dispense",
        "before=" + std::to_string(before) + ", after=" + std::to_string(after)
    );
}

// Test findNearestFilled and findNearestEmptyCCW indirectly
void test_nearest_slot_logic() {
    DispenseWheel w;
    // Clear all except slot 1 using mutable accessor
    for (int i = 0; i < 5; i++) w.slotsMutable()[i] = (i==1 ? 1 : 0);
    int8_t nearestFilled = w.dispense() ? w.windowIndex() : -1;
    bool passed = (nearestFilled == 1);
    printTestResult(
        "Nearest filled slot",
        passed,
        "windowIndex=1",
        "windowIndex=" + std::to_string(nearestFilled)
    );
}

int main() {
    std::cout << "=== Starting DispenseWheel Tests ===\n\n";
    test_initial_state();
    test_dispense();
    test_dispense_until_empty();
    test_return();
    test_advance_index();
    test_nearest_slot_logic();
    std::cout << "=== All tests executed ===\n";
}


