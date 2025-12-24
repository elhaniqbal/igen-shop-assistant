#include "dispense_wheel_logic.h"

DispenseWheel::DispenseWheel() {
    window_idx_ = 0;
    slots_[0] = 0;
    for (int i = 1; i < DRUM_N; i++) {
        slots_[i] = 1;
    }
}

uint8_t DispenseWheel::windowIndex() const {
    return window_idx_;
}

const uint8_t* DispenseWheel::slots() const {
    return slots_;
}

int8_t DispenseWheel::findNearestFilled() const {
    for (int i = 1; i < DRUM_N; i++) {
        if (slots_[i] == 1) return i;
    }
    return -1;
}

int8_t DispenseWheel::findNearestEmptyCCW() const {
    for (int i = DRUM_N - 1; i >= 0; i--) {
        if (slots_[i] == 0) return i;
    }
    return -1;
}

bool DispenseWheel::dispense() {
    int8_t idx = findNearestFilled();
    if (idx < 0) return false;

    window_idx_ = idx;
    slots_[idx] = 0;
    return true;
}

bool DispenseWheel::returnItem() {
    if (window_idx_ == 0) return false;

    slots_[window_idx_] = 1;
    int8_t idx = findNearestEmptyCCW();
    if (idx < 0) return false;

    window_idx_ = idx;
    return true;
}