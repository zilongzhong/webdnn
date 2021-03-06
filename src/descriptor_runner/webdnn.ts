///<reference path="./gpu_interface/gpu_interface.ts" />
///<reference path="./gpu_interface/gpu_interface_webgpu.ts" />
///<reference path="./gpu_interface/gpu_interface_webassembly.ts" />
///<reference path="./gpu_interface/gpu_interface_fallback.ts" />

namespace WebDNN {
    export let gpu: GPUInterface;

    let givenBackendOptions: { [key: string]: any };
    let tryingBackendOrder: string[];
    let loadedBackendName: string;

    async function tryInitNext(): Promise<string> {
        let backend_name = tryingBackendOrder.shift();
        if (!backend_name) {
            throw new Error('No backend is available');
        }

        let option = givenBackendOptions[backend_name];
        let gpuif: GPUInterface;
        try {
            switch (backend_name) {
                case 'webgpu':
                    gpuif = new GPUInterfaceWebGPU(option);
                    break;
                case 'webassembly':
                    gpuif = new GPUInterfaceWebassembly(option);
                    break;
                case 'fallback':
                    gpuif = new GPUInterfaceFallback(option);
                    break;
                default:
                    throw new Error('Unknown backend ' + backend_name);
            }
            await gpuif.init();
            gpu = gpuif;
            loadedBackendName = backend_name;
        } catch (ex) {
            console.warn(`Failed to initialize ${backend_name} backend: ${ex}`);
            return await tryInitNext();
        }

        return loadedBackendName;
    }

    export async function init(backendOrder?: string | string[], backendOptions: { [key: string]: any } = {}): Promise<string> {
        if (!backendOrder) {
            backendOrder = ['webgpu', 'webassembly'];
        } else if (typeof backendOrder === 'string') {
            backendOrder = [backendOrder];
        }

        givenBackendOptions = backendOptions;
        tryingBackendOrder = backendOrder.concat(['fallback']);

        await tryInitNext();

        return loadedBackendName;
    }

    /**
     * Prepare backend interface and load model data at once. Internally calls init().
     * @param backendOrder The trying order of backend names to be initialized.
     * @param backendOptions Backend options.
     * @param progressCallback callback which is called to notice the loading is progressing.
     */
    export interface InitOption {
        backendOrder?: string | string[],
        backendOptions?: { [key: string]: any },
        progressCallback?: (loaded: number, total: number) => any
    }

    /**
     * Prepare backend interface and load model data at once. Internally calls init().
     * @param directory URL of directory that contains graph descriptor files (e.g. graph_fallback.json)
     * @param initOption Initialize option
     * @return Interface to input/output data and run the model.
     */
    export async function prepareAll(directory: string, initOption: InitOption = {}): Promise<GraphInterface> {
        await init(initOption.backendOrder, initOption.backendOptions);

        while (true) {
            try {
                let runner = gpu.createDescriptorRunner();
                await runner.load(directory, initOption.progressCallback);

                let inputViews = await runner.getInputViews();
                let outputViews = await runner.getOutputViews();

                return {
                    backendName: loadedBackendName,
                    inputViews: inputViews,
                    outputViews: outputViews,
                    run: runner.run.bind(runner)
                };

            } catch (ex) {
                console.error(`Model loading failed for ${loadedBackendName} backend. Trying next backend. ${ex.message}`);
                await tryInitNext();
            }
        }
    }

    /**
     * Interface to input/output data and run the model.
     */
    export interface GraphInterface {
        /**
         * The name of backend.
         */
        backendName: string;
        /**
         * The buffers to write input data.
         */
        inputViews: Float32Array[];
        /**
         * The buffers to read output data.
         */
        outputViews: Float32Array[];
        /**
         * Run the model.
         */
        run: () => Promise<void>;
    }
}
