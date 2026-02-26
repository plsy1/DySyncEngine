import { useRegisterSW } from 'virtual:pwa-register/react'

function ReloadPrompt() {
    const {
        needRefresh: [needRefresh, setNeedRefresh],
        updateServiceWorker,
    } = useRegisterSW({
        onRegistered(r) {
            console.log('SW Registered: ' + r)
        },
        onRegisterError(error) {
            console.log('SW registration error', error)
        },
    })

    const close = () => {
        setNeedRefresh(false)
    }

    return (
        <div className="fixed right-0 bottom-0 m-4 z-50">
            {needRefresh && (
                <div className="bg-white text-black p-4 rounded-lg shadow-xl border border-gray-200 flex flex-col gap-2 min-w-[200px]">
                    <div className="text-sm font-medium">
                        <span>New content available, click on reload button to update.</span>
                    </div>
                    <div className="flex gap-2 justify-end">
                        <button
                            className="px-3 py-1 bg-black text-white text-xs rounded hover:bg-gray-800 transition-colors"
                            onClick={() => updateServiceWorker(true)}
                        >
                            Reload
                        </button>
                        <button
                            className="px-3 py-1 border border-gray-300 text-xs rounded hover:bg-gray-50 transition-colors"
                            onClick={() => close()}
                        >
                            Close
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}

export default ReloadPrompt
