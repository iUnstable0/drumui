import * as Slider from "@kobalte/core/slider";

interface RangeControlProps {
	label: string;
	value: number;
	min: number;
	max: number;
	step: number;
	disabled?: boolean;
	valueText?: string;
	onChange: (value: number) => void;
}

export function RangeControl(props: RangeControlProps) {
	return (
		<Slider.Root
			class="range-control"
			value={[props.value]}
			minValue={props.min}
			maxValue={props.max}
			step={props.step}
			disabled={props.disabled}
			getValueLabel={({ values }) => props.valueText ?? String(values[0] ?? props.value)}
			onChange={(values) => props.onChange(values[0] ?? props.value)}
		>
			<div class="range-control__meta">
				<Slider.Label class="range-control__label">{props.label}</Slider.Label>
				<Slider.ValueLabel class="range-control__value" />
			</div>
			<Slider.Track class="range-control__track">
				<Slider.Fill class="range-control__fill" />
				<Slider.Thumb class="range-control__thumb">
					<Slider.Input />
				</Slider.Thumb>
			</Slider.Track>
		</Slider.Root>
	);
}
