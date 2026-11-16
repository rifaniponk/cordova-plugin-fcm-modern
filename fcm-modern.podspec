Pod::Spec.new do |spec|
  spec.name = 'FCMModern'
  spec.version = '8.0.0'
  spec.summary = 'Firebase Cloud Messaging shared native core for Cordova/Capacitor iOS apps.'
  spec.description = <<-DESC
  Runtime-free Objective-C shared core (token/registration, APNs readiness,
  topics, permission, foreground presentation, startup buffering, receipt/tap
  dedup, payload sanitizer). The pod ships the shared core only:
  the Cordova CDVPlugin adapter is compiled in the app target via plugin.xml
  source-file entries, and the Capacitor Swift adapter is delivered through
  Package.swift. A host installs exactly one runtime adapter; Firebase
  Analytics is not a dependency.
  DESC
  spec.homepage = 'https://github.com/rifaniponk/cordova-plugin-fcm-modern'
  spec.license = { :type => 'MIT', :file => 'LICENSE' }
  spec.author = { 'Rifan MF' => 'rifaniponk@users.noreply.github.com' }
  spec.source = {
    :git => 'https://github.com/rifaniponk/cordova-plugin-fcm-modern.git',
    :tag => spec.version.to_s
  }

  # Firebase Apple SDK 13.1.1 requires iOS 15 as its deployment target.
  spec.platform = :ios, '15.0'
  spec.requires_frameworks = true

  # Shared core only. Cordova adapter: plugin.xml. Capacitor adapter: SPM.
  spec.source_files = 'src/ios/core/**/*.{h,m}'
  spec.public_header_files = 'src/ios/core/*.h'

  spec.dependency 'Firebase/Messaging', '~> 13.1.1'

  spec.pod_target_xcconfig = {
    'GCC_ENABLE_OBJC_EXCEPTIONS' => 'YES'
  }
end
