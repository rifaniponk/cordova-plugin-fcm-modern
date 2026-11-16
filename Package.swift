// swift-tools-version: 5.9
// SPM route for the Capacitor iOS plugin (Capacitor 8 default package manager).
// Mixed-language layout: Objective-C shared core is its own target so Swift
// can import it as a module; the Cordova adapter is deliberately NOT part of
// this package (it imports <Cordova/CDV.h> and is compiled only by cordova-ios
// via plugin.xml). CocoaPods consumers get the shared core via
// fcm-modern.podspec; the Swift adapter is SPM-only.
//
// Setup (documented, normal Capacitor discovery — no manual native
// registration beyond adding the package):
//   JS:   registerPlugin({ name: 'FCMModernPlugin' }) via the /capacitor entry
//   Xcode: add this package (products: FCMModernCore, FCMModern)
//   AppDelegate: FCMModernPlugin.bootstrap() + remote-notification forwarding
//   per the pattern documented in src/ios/core/FCMNotificationDelegate.h.
import PackageDescription

let package = Package(
    name: "FCMModern",
    platforms: [
        .iOS(.v15), // Firebase Apple SDK 13.1.1 minimum deployment target
    ],
    products: [
        .library(name: "FCMModernCore", targets: ["FCMModernCore"]),
        .library(name: "FCMModern", targets: ["FCMModern"]),
    ],
    dependencies: [
        .package(url: "https://github.com/firebase/firebase-ios-sdk.git", .exact("13.1.1")),
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0"),
    ],
    targets: [
        // Runtime-free Objective-C shared core (no Capacitor/Cordova imports).
        .target(
            name: "FCMModernCore",
            dependencies: [
                .product(name: "FirebaseMessaging", package: "firebase-ios-sdk"),
            ],
            path: "src/ios/core",
            publicHeadersPath: "."
        ),
        // Capacitor Swift adapter sharing the same core classes.
        .target(
            name: "FCMModern",
            dependencies: [
                "FCMModernCore",
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
            ],
            path: "src/ios/capacitor"
        ),
    ]
)
