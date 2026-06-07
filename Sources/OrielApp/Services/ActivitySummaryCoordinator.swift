import Foundation

struct ActivitySummarySettings {
    let enabled: Bool
    let frequencyPreset: String
    let dailyCap: Int
    let timeoutSeconds: Int

    static let disabled = ActivitySummarySettings(
        enabled: false,
        frequencyPreset: "balanced",
        dailyCap: 100,
        timeoutSeconds: 20
    )

    var dwellSeconds: Int {
        switch frequencyPreset {
        case "low":
            return 120
        case "high":
            return 45
        default:
            return 60
        }
    }

    var sameContextCooldownSeconds: Int {
        switch frequencyPreset {
        case "low":
            return 30 * 60
        case "high":
            return 5 * 60
        default:
            return 10 * 60
        }
    }
}

enum ActivitySummaryEnqueueDecision: Equatable {
    case enqueue
    case disabled
    case belowMinimumDwell
    case dailyCapReached
    case queueFull
    case cooldownActive
}

final class ActivitySummaryCoordinator {
    private let queue = DispatchQueue(label: "so.sil.oriel.activity-summary", qos: .utility)
    private let lock = NSLock()
    private let maxPending: Int
    private let calendar: Calendar
    private var pendingCount = 0
    private var analyzedToday = 0
    private var lastContextAt: [String: Date] = [:]
    private var countDayStart: Date

    init(maxPending: Int = 8, calendar: Calendar = .current, now: Date = Date()) {
        self.maxPending = maxPending
        self.calendar = calendar
        self.countDayStart = calendar.startOfDay(for: now)
    }

    func shouldEnqueue(contextKey: String, settings: ActivitySummarySettings, now: Date = Date()) -> Bool {
        decision(contextKey: contextKey, durationSeconds: settings.dwellSeconds, settings: settings, now: now) == .enqueue
    }

    func decision(
        contextKey: String,
        durationSeconds: Int,
        settings: ActivitySummarySettings,
        now: Date = Date()
    ) -> ActivitySummaryEnqueueDecision {
        lock.lock()
        defer { lock.unlock() }

        resetDailyCountIfNeeded(now: now)

        guard settings.enabled else { return .disabled }
        guard durationSeconds >= settings.dwellSeconds else { return .belowMinimumDwell }
        guard analyzedToday < settings.dailyCap else { return .dailyCapReached }
        guard pendingCount < maxPending else { return .queueFull }
        if let last = lastContextAt[contextKey],
           now.timeIntervalSince(last) < TimeInterval(settings.sameContextCooldownSeconds) {
            return .cooldownActive
        }

        lastContextAt[contextKey] = now
        pendingCount += 1
        return .enqueue
    }

    func enqueueReserved(_ work: @escaping () async -> Void, completion: (() -> Void)? = nil) {
        queue.async { [weak self] in
            defer {
                self?.markFinished()
                completion?()
            }
            let semaphore = DispatchSemaphore(value: 0)
            Task {
                await work()
                semaphore.signal()
            }
            semaphore.wait()
        }
    }

    private func markFinished() {
        lock.lock()
        pendingCount = max(0, pendingCount - 1)
        analyzedToday += 1
        lock.unlock()
    }

    private func resetDailyCountIfNeeded(now: Date) {
        let dayStart = calendar.startOfDay(for: now)
        guard dayStart != countDayStart else { return }
        countDayStart = dayStart
        analyzedToday = 0
        lastContextAt.removeAll()
    }
}
