import lionImg from '../assets/lion.png'

export function Logo({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <img
        src={lionImg}
        alt="TakeSmart"
        className="h-9 w-auto object-contain"
      />
      <span className="text-xl font-bold text-gray-900">
        Take<span className="text-yellow-500">Smart</span>
      </span>
    </div>
  )
}

export function LogoWhite({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <img
        src={lionImg}
        alt="TakeSmart"
        className="h-9 w-auto object-contain"
      />
      <span className="text-xl font-bold text-white">
        Take<span className="text-yellow-400">Smart</span>
      </span>
    </div>
  )
}
