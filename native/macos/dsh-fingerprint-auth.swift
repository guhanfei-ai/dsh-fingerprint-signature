import Foundation
import LocalAuthentication

func writeResult(_ status: String, error: String? = nil) -> Never {
    var result: [String: String] = ["status": status]
    if let error, !error.isEmpty { result["error"] = error }
    if let data = try? JSONSerialization.data(withJSONObject: result),
       let text = String(data: data, encoding: .utf8) {
        print(text)
    } else {
        print("{\"status\":\"failed\",\"error\":\"unable to encode helper response\"}")
    }
    fflush(stdout)
    exit(status == "verified" ? 0 : status == "unavailable" ? 2 : 1)
}

let arguments = CommandLine.arguments
var reason = "请确认允许 AI 继续执行关键操作"
if let index = arguments.firstIndex(of: "--reason"), index + 1 < arguments.count {
    reason = arguments[index + 1]
}

let context = LAContext()
var availabilityError: NSError?
guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &availabilityError) else {
    writeResult("unavailable", error: availabilityError?.localizedDescription ?? "系统验证器不可用")
}

let semaphore = DispatchSemaphore(value: 0)
var resultStatus = "failed"
var resultError: String?
context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { success, error in
    if success {
        resultStatus = "verified"
    } else if let laError = error as? LAError, laError.code == .userCancel || laError.code == .appCancel || laError.code == .systemCancel {
        resultStatus = "cancelled"
    } else {
        resultStatus = "failed"
        resultError = error?.localizedDescription ?? "系统验证失败"
    }
    semaphore.signal()
}
semaphore.wait()
writeResult(resultStatus, error: resultError)
