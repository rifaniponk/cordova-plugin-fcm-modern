Pod::Spec.new do |spec|
  spec.name = 'FCMModern'
  spec.version = '8.0.0'
  spec.summary = 'Firebase Cloud Messaging shared native core and Cordova adapter for Cordova/Capacitor apps.'
  spec.description = <<-DESC
  Objective-C shared core (token, topics, permission, channels, event bus,
  payload sanitizer) plus the Cordova CDVPlugin adapter. Capacitor uses the
  separate Swift/SPM route; a host installs exactly one runtime adapter.
  DESC
  spec.homepage = 'https://github.com/rifaniponk/cordova-plugin-fcm-modern'
  spec.license = { :type => 'MIT', :file => 'LICENSE' }
  spec.author = { 'Rifan MF' => 'rifaniponk@users.noreply.github.com' }
  spec.source = {
    :git => 'https://github.com/rifaniponk/cordova-plugin-fcm-modern.git',
    :tag => spec.version.to_s
  }

  spec.platform = :ios, '13.0'
  spec.requires_frameworks = true

  # The shared iOS core + Cordova adapter only. The Capacitor Swift adapter is
  # delivered through Package.swift, never through this pod.
  spec.source_files = 'src/ios/**/*.{h,m}'

  spec.dependency 'Firebase/Messaging', '~> 13.1.1'

  spec.pod_target_xcconfig = {
    'GCC_ENABLE_OBJC_EXCEPTIONS' => 'YES'
  }
end
