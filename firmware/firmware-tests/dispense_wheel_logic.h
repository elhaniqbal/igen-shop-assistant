#pragma once
#include <cstdint>

class DispenseWheel {
public:
    static constexpr uint8_t DRUM_N = 5;

    DispenseWheel();

    uint8_t windowIndex() const;
    bool dispense();
    bool returnItem();

    const uint8_t* slots() const;

    // Add this for testing only
    uint8_t* slotsMutable() { return slots_; }

private:
    uint8_t window_idx_;
    uint8_t slots_[DRUM_N];

    int8_t findNearestFilled() const;
    int8_t findNearestEmptyCCW() const;
};